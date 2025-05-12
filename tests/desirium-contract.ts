import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { DesiriumContract } from "../target/types/desirium_contract";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, createAccount, mintTo } from "@solana/spl-token";
import { assert } from "chai";

describe("desirium-contract", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.DesiriumContract as Program<DesiriumContract>;
  
  // Test accounts
  const authority = Keypair.generate();
  const donor = Keypair.generate();
  const platform = Keypair.generate();
  
  // Test data
  const ipfsUrl = "ipfs://QmTestHash";
  const donationAmount = new anchor.BN(1000000); // 1 token with 6 decimals
  
  // Token accounts
  let mint: PublicKey;
  let donorTokenAccount: PublicKey;
  let platformTokenAccount: PublicKey;
  let wishlistPda: PublicKey;
  let wishlistBump: number;

  before(async () => {
    // Airdrop SOL to test accounts
    const airdropAmount = LAMPORTS_PER_SOL;
    for (const kp of [authority, donor, platform]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, airdropAmount);
      await provider.connection.confirmTransaction(sig, "confirmed");
    }
    
    // Create test token mint
    mint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );
    
    // Create token accounts
    donorTokenAccount = await createAccount(
      provider.connection,
      donor,
      mint,
      donor.publicKey
    );
    
    platformTokenAccount = await createAccount(
      provider.connection,
      platform,
      mint,
      platform.publicKey
    );
    
    // Mint tokens to donor
    await mintTo(
      provider.connection,
      authority,
      mint,
      donorTokenAccount,
      authority,
      donationAmount.toNumber()
    );
    
    // Find PDA for wishlist
    [wishlistPda, wishlistBump] = await PublicKey.findProgramAddress(
      [Buffer.from("wishlist"), authority.publicKey.toBuffer()],
      program.programId
    );
  });

  it("Creates a wishlist", async () => {
    const tx = await program.methods
      .createWishlist(ipfsUrl)
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
  });

  it("Accepts donations", async () => {
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
    const donorBalance = await provider.connection.getTokenAccountBalance(donorTokenAccount);
    const platformBalance = await provider.connection.getTokenAccountBalance(platformTokenAccount);
    
    assert.equal(donorBalance.value.amount, "0");
    assert.equal(platformBalance.value.amount, donationAmount.toString());
  });

  it("Fails when donor has insufficient balance", async () => {
    try {
      await program.methods
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
      
      assert.fail("Expected transaction to fail");
    } catch (error) {
      assert.include(error.message, "insufficient funds");
    }
  });
});
