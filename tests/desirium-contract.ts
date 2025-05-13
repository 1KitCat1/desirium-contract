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

   // Two users
   let user1: Keypair;
   let user2: Keypair;
   let user1TokenAccount: PublicKey;
   let user2TokenAccount: PublicKey;

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


    user1 = Keypair.generate();
    user2 = Keypair.generate();

    // Airdrop SOL to users so they can pay fees
    await airdropSol(user1.publicKey, provider);
    await airdropSol(user2.publicKey, provider);

    // Create token accounts for users
    user1TokenAccount = await createTokenAccountIfNeeded(mint, user1.publicKey, provider);
    user2TokenAccount = await createTokenAccountIfNeeded(mint, user2.publicKey, provider);

    // Mint tokens to users
    await mintTo(mint, user1TokenAccount, 100 * 10 ** decimals, provider);
    await mintTo(mint, user2TokenAccount, 100 * 10 ** decimals, provider);

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

  it("User1 transfers tokens into vault", async () => {
    await program.methods.transferIn(new anchor.BN(1 * 10 ** decimals)).accounts({
      tokenAccountOwnerPda,
      vaultTokenAccount: tokenVault,
      senderTokenAccount: user1TokenAccount,
      mintOfTokenBeingSent: mint,
      signer: user1.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([user1]).rpc();

    const userBalance = await getAccountBalance(user1TokenAccount);
    const vaultBalance = await getAccountBalance(tokenVault);

    assert.equal(userBalance, BigInt(99), "User1 should have 99 tokens left");
    assert.equal(vaultBalance, BigInt(1), "Vault should have 1 token");
  });

  it("User2 transfers tokens into vault", async () => {
    await program.methods.transferIn(new anchor.BN(1 * 10 ** decimals)).accounts({
      tokenAccountOwnerPda,
      vaultTokenAccount: tokenVault,
      senderTokenAccount: user2TokenAccount,
      mintOfTokenBeingSent: mint,
      signer: user2.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([user2]).rpc();

    const userBalance = await getAccountBalance(user2TokenAccount);
    const vaultBalance = await getAccountBalance(tokenVault);

    assert.equal(userBalance, BigInt(99), "User2 should have 99 tokens left");
    assert.equal(vaultBalance, BigInt(2), "Vault should have 2 tokens total");
  });

  async function getAccountBalance(account: PublicKey): Promise<bigint> {
    const acc = await getAccount(provider.connection, account);
    return acc.amount / mintDecimals;
  }
});

async function airdropSol(pubkey: PublicKey, provider: anchor.AnchorProvider) {
  const sig = await provider.connection.requestAirdrop(pubkey, 1_000_000_000);
  await provider.connection.confirmTransaction(sig, "confirmed");
}

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
