import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { DesiriumContract } from "../target/types/desirium_contract";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  getAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("desirium-contract", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.DesiriumContract as Program<DesiriumContract>;

  // Test accounts
  const authority = Keypair.generate();
  const donor = Keypair.generate();
  const platform = Keypair.generate();

  // Test data
  const ipfsUrl = "ipfs://QmTestHash";
  const donationAmount = new anchor.BN(1000000);

  // Token accounts
  let tokenMint: PublicKey;
  let donorTokenAccount: PublicKey;
  let platformTokenAccount: PublicKey;
  let wishlistPda: PublicKey;
  let wishlistBump: number;
  let vaultPda: PublicKey;
  let vaultBump: number;
  let vaultTokenAccount: PublicKey;
  let authorityTokenAccount: PublicKey;

  before(async () => {
    console.log(0.1)
    // Airdrop SOL to test accounts
    const airdropAmount = LAMPORTS_PER_SOL;
    for (const kp of [authority, donor, platform]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        airdropAmount
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }
    console.log(0.2)

    // Create token mint
    tokenMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );

    console.log(0.3)


    // Create donor and platform token accounts
    donorTokenAccount = await createAccount(
      provider.connection,
      donor,
      tokenMint,
      donor.publicKey
    );
    console.log(0.4)

    platformTokenAccount = await createAccount(
      provider.connection,
      platform,
      tokenMint,
      platform.publicKey
    );
    console.log(0.5)


    // Mint tokens to donor
    await mintTo(
      provider.connection,
      authority,
      tokenMint,
      donorTokenAccount,
      authority.publicKey,
      10000000
    );
    console.log(0.6)

    // Setup authority's ATA
    authorityTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      authority.publicKey
    );

    console.log(0.7)

    if (!(await provider.connection.getAccountInfo(authorityTokenAccount))) {
      await createAssociatedTokenAccount(
        provider.connection,
        authority,
        tokenMint,
        authority.publicKey
      );
    }

    console.log(0.8)


    // Find PDAs
    console.log("program.programId:", program.programId?.toBase58());

    [wishlistPda, wishlistBump] = await PublicKey.findProgramAddress(
      [Buffer.from("wishlist"), authority.publicKey.toBuffer()],
      program.programId
    );
    console.log(0.9)


    console.log("program.programId:", program.programId?.toBase58());

    const [vaultPda, vaultBump] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), authority.publicKey.toBuffer()],
      program.programId
    );

    console.log(1)
    // Create vault token account (PDA-owned ATA)
    vaultTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      vaultPda,
      true // Allow off-curve owner
    );
    console.log(1.1)

    const vaultTokenAccountKeypair = Keypair.generate();
    vaultTokenAccount = vaultTokenAccountKeypair.publicKey;

    await createAccount(
      provider.connection,
      authority, // payer
      tokenMint,
      vaultPda, // owner PDA (off-curve)
      vaultTokenAccountKeypair // new token account keypair
    );
    
    console.log(1.2)

    // Fund vault token account
    await mintTo(
      provider.connection,
      authority,
      tokenMint,
      vaultTokenAccount,
      authority.publicKey,
      10_000_000
    );
    console.log(1.3)

  });


  it("Creates a wishlist", async () => {
    const tx = await program.methods
      .createWishlist(ipfsUrl, tokenMint)
      .accounts({
        wishlist: wishlistPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    console.log("Wishlist creation tx:", tx);

    // Fetch the created wishlist
    const wishlist = await program.account.wishlist.fetch(wishlistPda);

    // Verify wishlist data
    assert.equal(wishlist.authority.toString(), authority.publicKey.toString());
    assert.equal(wishlist.ipfsUrl, ipfsUrl);
    assert.equal(wishlist.totalDonations.toNumber(), 0);
    assert.equal(wishlist.tokenMint.toString(), tokenMint.toString());
  });

  it("Accepts donations in the specified token", async () => {
    const tx = await program.methods
      .donate(donationAmount)
      .accounts({
        wishlist: wishlistPda,
        donor: donor.publicKey,
        donorTokenAccount: donorTokenAccount,
        platformTokenAccount: platformTokenAccount,
        platform: platform.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([donor])
      .rpc();

    console.log("Donation tx:", tx);

    // Fetch the updated wishlist
    const wishlist = await program.account.wishlist.fetch(wishlistPda);

    // Verify donation was recorded
    assert.equal(wishlist.totalDonations.toNumber(), donationAmount.toNumber());

    // Verify token balances
    const donorBalance = await provider.connection.getTokenAccountBalance(
      donorTokenAccount
    );
    const platformBalance = await provider.connection.getTokenAccountBalance(
      platformTokenAccount
    );

    assert.equal(donorBalance.value.amount, "9000000"); // 10 - 1 = 9 tokens
    assert.equal(platformBalance.value.amount, donationAmount.toString());
  });

  it("Fails when trying to donate with a different token", async () => {
    // Create a different token mint
    const differentMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );

    // Create a token account for donor with the different token
    const differentTokenAccount = await createAccount(
      provider.connection,
      donor,
      differentMint,
      donor.publicKey
    );

    // Mint some of the different token to donor
    await mintTo(
      provider.connection,
      authority,
      differentMint,
      differentTokenAccount,
      authority.publicKey,
      10000000 // 10 tokens
    );

    try {
      await program.methods
        .donate(donationAmount)
        .accounts({
          wishlist: wishlistPda,
          donor: donor.publicKey,
          donorTokenAccount: differentTokenAccount, // Using different token
          platformTokenAccount: platformTokenAccount,
          platform: platform.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([donor])
        .rpc();

      assert.fail("Expected transaction to fail");
    } catch (error) {
      assert.include(error.message, "A raw constraint was violated");
    }
  });

  it("Withdraws tokens from vault to authority", async () => {
    const withdrawAmount = new anchor.BN(3_000_000);
    
    await program.methods
      .withdraw(withdrawAmount)
      .accounts({
        vault: vaultTokenAccount,
        authority: authority.publicKey,
        authorityTokenAccount: authorityTokenAccount,
        tokenMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    // Check balances
    const vaultBalance = await getAccount(
      provider.connection,
      vaultTokenAccount
    );
    const authorityBalance = await getAccount(
      provider.connection,
      authorityTokenAccount
    );

    assert.equal(vaultBalance.amount.toString(), "7000000");
    assert.equal(authorityBalance.amount.toString(), "3000000");
  });

  it("Fails to withdraw more tokens than vault balance", async () => {
    const vaultBalance = await getAccount(
      provider.connection,
      vaultTokenAccount
    );
    const withdrawAmount = new anchor.BN(Number(vaultBalance.amount) + 1);

    try {
      await program.methods
        .withdraw(withdrawAmount)
        .accounts({
          vault: vaultTokenAccount,
          authority: authority.publicKey,
          authorityTokenAccount: authorityTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();

      assert.fail("Expected withdrawal to fail due to insufficient balance");
    } catch (error) {
      assert.include(error.message, "Insufficient balance");
    }
  });
});
