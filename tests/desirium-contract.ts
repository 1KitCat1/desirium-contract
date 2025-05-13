import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

describe("token_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.TokenVault as Program;

  const decimals = 9;
  const mintDecimals = BigInt(10 ** decimals);
  const targetAmount = BigInt(10 * 10 ** decimals); // Set target to 10 tokens

  let mint: PublicKey;
  let vaultConfigPda: PublicKey;
  let tokenVault: PublicKey;
  let user1: Keypair;
  let user2: Keypair;
  let user1TokenAccount: PublicKey;
  let user2TokenAccount: PublicKey;

  before(async () => {
    // Create mint
    mint = await createMint(decimals, provider);

    // Derive PDAs
    [vaultConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_config")],
      program.programId
    );

    [tokenVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault"), mint.toBuffer()],
      program.programId
    );

    // Create test users
    user1 = Keypair.generate();
    user2 = Keypair.generate();

    // Airdrop SOL to users
    await airdropSol(user1.publicKey, provider);
    await airdropSol(user2.publicKey, provider);

    // Create token accounts
    user1TokenAccount = await createTokenAccountIfNeeded(
      mint,
      user1.publicKey,
      provider
    );
    user2TokenAccount = await createTokenAccountIfNeeded(
      mint,
      user2.publicKey,
      provider
    );

    // Mint tokens to users
    await mintTo(mint, user1TokenAccount, 100 * 10 ** decimals, provider);
    await mintTo(mint, user2TokenAccount, 100 * 10 ** decimals, provider);
  });

  it("Initialize vault with target amount", async () => {
    // Use BigNumber for the initialize call with the target amount
    const targetAmountBN = new anchor.BN(targetAmount.toString());
    
    const tx = await program.methods
      .initialize(targetAmountBN)
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultTokenAccount: tokenVault,
        tokenMint: mint,
        signer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log("Initialize tx:", tx);

    // Verify vault is empty
    const vaultAccount = await getAccount(provider.connection, tokenVault);
    assert.equal(vaultAccount.amount, BigInt(0), "Vault should start empty");

    // Verify the target amount was set correctly
    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    assert.equal(
      vaultConfig.targetAmount.toString(), 
      targetAmount.toString(),
      "Target amount should be set correctly"
    );
  });

  it("User1 transfers tokens into vault", async () => {
    // Convert amount to Anchor's BN type
    const amount = new anchor.BN((1 * 10 ** decimals).toString());
    
    await program.methods
      .transferIn(amount)
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultTokenAccount: tokenVault,
        senderTokenAccount: user1TokenAccount,
        signer: user1.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user1])
      .rpc();

    const userBalance = await getAccountBalance(user1TokenAccount);
    const vaultBalance = await getAccountBalance(tokenVault);

    assert.equal(userBalance, BigInt(99), "User1 should have 99 tokens left");
    assert.equal(vaultBalance, BigInt(1), "Vault should have 1 token");
  });

  it("User2 transfers tokens into vault", async () => {
    // Convert amount to Anchor's BN type
    const amount = new anchor.BN((1 * 10 ** decimals).toString());
    
    await program.methods
      .transferIn(amount)
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultTokenAccount: tokenVault,
        senderTokenAccount: user2TokenAccount,
        signer: user2.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user2])
      .rpc();

    const userBalance = await getAccountBalance(user2TokenAccount);
    const vaultBalance = await getAccountBalance(tokenVault);

    assert.equal(userBalance, BigInt(99), "User2 should have 99 tokens left");
    assert.equal(vaultBalance, BigInt(2), "Vault should have 2 tokens");
  });

  it("Checks funding progress against target", async () => {
    const vaultBalance = await getAccountBalance(tokenVault);
    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    
    const targetAmountTokens = BigInt(vaultConfig.targetAmount.toString()) / mintDecimals;
    const progress = (vaultBalance * BigInt(100)) / targetAmountTokens;
    
    console.log(`Funding progress: ${progress}% (${vaultBalance} of ${targetAmountTokens} tokens)`);
    
    // Verify we're not yet at target
    assert.isBelow(
      Number(progress), 
      100, 
      "Vault should not yet be fully funded"
    );
  });

  it("Fails when user tries to fund vault with incorrect token mint", async () => {
    // Create a second mint (wrong mint)
    const wrongMint = await createMint(decimals, provider);
  
    // Create token account for user1 with wrong mint
    const wrongTokenAccount = await createTokenAccountIfNeeded(wrongMint, user1.publicKey, provider);
  
    // Mint tokens to wrong token account
    await mintTo(wrongMint, wrongTokenAccount, 100 * 10 ** decimals, provider);
  
    // Attempt transferIn with wrong token account - should fail constraint check
    try {
      // Convert amount to Anchor's BN type
      const amount = new anchor.BN((1 * 10 ** decimals).toString());
      
      await program.methods
        .transferIn(amount)
        .accounts({
          vaultConfig: vaultConfigPda,
          vaultTokenAccount: tokenVault,
          senderTokenAccount: wrongTokenAccount,
          signer: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();
  
      assert.fail("transferIn should have failed due to mint mismatch constraint");
    } catch (error: any) {
      const errMsg = error.error?.msg ?? error.toString();
      // Anchor constraint raw error code is 2003
      assert.ok(
        errMsg.includes("A raw constraint was violated") || errMsg.includes("ConstraintRaw"),
        `Expected raw constraint error, got: ${errMsg}`
      );
    }
  });
  
  it("Transfer out tokens", async () => {
    // Convert amount to Anchor's BN type
    const amount = new anchor.BN((1 * 10 ** decimals).toString());
    
    await program.methods
      .transferOut(amount)
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultTokenAccount: tokenVault,
        senderTokenAccount: user1TokenAccount,
        signer: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const userBalance = await getAccountBalance(user1TokenAccount);
    const vaultBalance = await getAccountBalance(tokenVault);

    assert.equal(userBalance, BigInt(100), "User should have 100 tokens");
    assert.equal(vaultBalance, BigInt(1), "Vault should have 1 token left");
  });

  async function getAccountBalance(account: PublicKey): Promise<bigint> {
    const acc = await getAccount(provider.connection, account);
    return acc.amount / mintDecimals;
  }
});

// Helper functions
async function airdropSol(pubkey: PublicKey, provider: anchor.AnchorProvider) {
  const sig = await provider.connection.requestAirdrop(pubkey, 1_000_000_000);
  await provider.connection.confirmTransaction(sig, "confirmed");
}

async function createMint(
  decimals: number,
  provider: anchor.AnchorProvider
): Promise<PublicKey> {
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  const lamports = await getMinimumBalanceForRentExemptMint(
    provider.connection
  );

  const tx = new anchor.web3.Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: mint,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mint,
      decimals,
      provider.wallet.publicKey,
      provider.wallet.publicKey
    )
  );

  await provider.sendAndConfirm(tx, [mintKeypair]);
  return mint;
}

async function createTokenAccountIfNeeded(
  mint: PublicKey,
  owner: PublicKey,
  provider: anchor.AnchorProvider
): Promise<PublicKey> {
  const tokenAccount = getAssociatedTokenAddressSync(mint, owner);
  const info = await provider.connection.getAccountInfo(tokenAccount);
  if (!info) {
    const tx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        tokenAccount,
        owner,
        mint
      )
    );
    await provider.sendAndConfirm(tx);
  }
  return tokenAccount;
}

async function mintTo(
  mint: PublicKey,
  destination: PublicKey,
  amount: number,
  provider: anchor.AnchorProvider
) {
  const tx = new anchor.web3.Transaction().add(
    createMintToInstruction(
      mint,
      destination,
      provider.wallet.publicKey,
      amount
    )
  );
  await provider.sendAndConfirm(tx);
}
