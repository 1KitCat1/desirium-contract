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

  let mint: PublicKey;
  let tokenAccount: PublicKey;
  let tokenVault: PublicKey;
  let tokenAccountOwnerPda: PublicKey;

  before(async () => {
    // Create mint
    mint = await createMint(decimals, provider);
    
    // Derive PDAs
    [tokenAccountOwnerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_account_owner_pda")],
      program.programId
    );
    
    [tokenVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault"), mint.toBuffer()],
      program.programId
    );

    // Get or create user's token account
    tokenAccount = await createTokenAccountIfNeeded(mint, provider.wallet.publicKey, provider);
  });

  it("Initialize vault", async () => {
    const tx = await program.methods.initialize().accounts({
      tokenAccountOwnerPda,
      vaultTokenAccount: tokenVault,
      mintOfTokenBeingSent: mint,
      signer: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    }).rpc();

    console.log("Initialize tx:", tx);
    
    const vaultAccount = await getAccount(provider.connection, tokenVault);
    assert.equal(vaultAccount.amount, BigInt(0), "Vault should start with 0 balance");
  });

  it("Transfer in tokens", async () => {
    // Mint 100 tokens to user
    await mintTo(mint, tokenAccount, 100 * 10 ** decimals, provider);

    const initialBalance = await getAccountBalance(tokenAccount);
    assert.equal(initialBalance, BigInt(100), "User should have 100 tokens initially");

    // Transfer 1 token to vault
    await program.methods.transferIn(new anchor.BN(1 * 10 ** decimals)).accounts({
      tokenAccountOwnerPda,
      vaultTokenAccount: tokenVault,
      senderTokenAccount: tokenAccount,
      mintOfTokenBeingSent: mint,
      signer: provider.wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

    // Verify balances
    const userBalance = await getAccountBalance(tokenAccount);
    const vaultBalance = await getAccountBalance(tokenVault);
    
    assert.equal(userBalance, BigInt(99), "User should have 99 tokens after transfer");
    assert.equal(vaultBalance, BigInt(1), "Vault should have 1 token after transfer");
  });

  it("Transfer out tokens", async () => {
    // Withdraw 1 token from vault
    await program.methods.transferOut(new anchor.BN(1 * 10 ** decimals)).accounts({
      tokenAccountOwnerPda,
      vaultTokenAccount: tokenVault,
      senderTokenAccount: tokenAccount,
      mintOfTokenBeingSent: mint,
      signer: provider.wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

    // Verify balances
    const userBalance = await getAccountBalance(tokenAccount);
    const vaultBalance = await getAccountBalance(tokenVault);
    
    assert.equal(userBalance, BigInt(100), "User should have 100 tokens after withdrawal");
    assert.equal(vaultBalance, BigInt(0), "Vault should be empty after withdrawal");
  });

  async function getAccountBalance(account: PublicKey): Promise<bigint> {
    const acc = await getAccount(provider.connection, account);
    return acc.amount / mintDecimals;
  }
});

async function createMint(decimals: number, provider: anchor.AnchorProvider): Promise<PublicKey> {
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  const lamports = await getMinimumBalanceForRentExemptMint(provider.connection);

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
  
  const accountInfo = await provider.connection.getAccountInfo(tokenAccount);
  if (!accountInfo) {
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
