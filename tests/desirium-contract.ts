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
  import { BN } from "bn.js";
  import { TokenVault } from "../target/types/token_vault";

  
  const PROTOCOL_OWNER = new PublicKey(
    "55oBBfLE4LPAYQthXYkfNN5WZBzD4f5EfpPYkTMuP6RU" 
  );

  describe("token_vault - Multiple Vaults", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.TokenVault as Program<TokenVault>;

    const decimals = 9;
    const mintDecimals = BigInt(10 ** decimals);
    const targetAmount1 = BigInt(200 * 10 ** decimals);
    const targetAmount2 = BigInt(150 * 10 ** decimals);
    const vaultId1 = "vault-1";
    const vaultId2 = "vault-2";
    const vaultId3 = "user2-vault-1";
    const ipfsStr1 = "ipfs://HAsh1";
    const ipfsStr2 = "ipfs://HAsh2";
    const ipfsStr3 = "ipfs://HAsh3";

    let mint: PublicKey;
    let vaultConfig1Pda: PublicKey;
    let vaultConfig2Pda: PublicKey;
    let vaultConfig3Pda: PublicKey;
    let tokenVault1: PublicKey;
    let tokenVault2: PublicKey;
    let tokenVault3: PublicKey;
    let user1: Keypair;
    let user2: Keypair;
    let user1TokenAccount: PublicKey;
    let user2TokenAccount: PublicKey;
    let protocolTokenAccount: PublicKey;

    before(async () => {
      // Create mint
      mint = await createMint(decimals, provider);

      // Create test users
      user1 = Keypair.generate();
      user2 = Keypair.generate();

      // Derive PDAs for different vaults
      [vaultConfig1Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_config"), user1.publicKey.toBuffer(), Buffer.from(vaultId1)],
        program.programId
      );

      [vaultConfig2Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_config"), user1.publicKey.toBuffer(), Buffer.from(vaultId2)],
        program.programId
      );

      [vaultConfig3Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_config"), user2.publicKey.toBuffer(), Buffer.from(vaultId3)],
        program.programId
      );

      [tokenVault1] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), user1.publicKey.toBuffer(), Buffer.from(vaultId1), mint.toBuffer()],
        program.programId
      );

      [tokenVault2] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), user1.publicKey.toBuffer(), Buffer.from(vaultId2), mint.toBuffer()],
        program.programId
      );

      [tokenVault3] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), user2.publicKey.toBuffer(), Buffer.from(vaultId3), mint.toBuffer()],
        program.programId
      );

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
      await mintTo(mint, user1TokenAccount, 500 * 10 ** decimals, provider);
      await mintTo(mint, user2TokenAccount, 400 * 10 ** decimals, provider);

      // Create protocol token account using the same mint
      protocolTokenAccount = getAssociatedTokenAddressSync(
        mint,
        PROTOCOL_OWNER
      );
      if (!(await provider.connection.getAccountInfo(protocolTokenAccount))) {
        const tx = new anchor.web3.Transaction().add(
          createAssociatedTokenAccountInstruction(
            provider.wallet.publicKey,
            protocolTokenAccount,
            PROTOCOL_OWNER,
            mint
          )
        );
        await provider.sendAndConfirm(tx);
      }
    });

    it("User1 creates first vault", async () => {
      const targetAmountBN = new BN(targetAmount1.toString());

      const tx = await program.methods
        .initialize(vaultId1, targetAmountBN, ipfsStr1)
        .accounts({
          vaultConfig: vaultConfig1Pda,
          vaultTokenAccount: tokenVault1,
          tokenMint: mint,
          signer: user1.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      console.log("Initialize vault1 tx:", tx);

      // Verify vault is empty
      const vaultAccount = await getAccount(provider.connection, tokenVault1);
      assert.equal(vaultAccount.amount, BigInt(0), "Vault1 should start empty");

      // Verify the target amount and vault ID were set correctly
      const vaultConfig = await program.account.vaultConfig.fetch(vaultConfig1Pda);
      assert.equal(
        vaultConfig.targetAmount.toString(),
        targetAmount1.toString(),
        "Target amount should be set correctly"
      );
      assert.equal(vaultConfig.vaultId, vaultId1, "Vault ID should be set correctly");
      assert.equal(vaultConfig.authority.toString(), user1.publicKey.toString(), "Authority should be user1");
    });

    it("User1 creates second vault with different configuration", async () => {
      const targetAmountBN = new BN(targetAmount2.toString());

      const tx = await program.methods
        .initialize(vaultId2, targetAmountBN, ipfsStr2)
        .accounts({
          vaultConfig: vaultConfig2Pda,
          vaultTokenAccount: tokenVault2,
          tokenMint: mint,
          signer: user1.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      console.log("Initialize vault2 tx:", tx);

      // Verify vault configuration
      const vaultConfig = await program.account.vaultConfig.fetch(vaultConfig2Pda);
      assert.equal(
        vaultConfig.targetAmount.toString(),
        targetAmount2.toString(),
        "Target amount should be different for vault2"
      );
      assert.equal(vaultConfig.vaultId, vaultId2, "Vault ID should be vault-2");
      assert.equal(vaultConfig.ipfsLink, ipfsStr2, "IPFS link should be different");
    });

    it("User2 creates their own vault", async () => {
      const targetAmountBN = new BN(targetAmount1.toString());

      const tx = await program.methods
        .initialize(vaultId3, targetAmountBN, ipfsStr3)
        .accounts({
          vaultConfig: vaultConfig3Pda,
          vaultTokenAccount: tokenVault3,
          tokenMint: mint,
          signer: user2.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();

      console.log("Initialize vault3 tx:", tx);

      // Verify vault configuration
      const vaultConfig = await program.account.vaultConfig.fetch(vaultConfig3Pda);
      assert.equal(vaultConfig.authority.toString(), user2.publicKey.toString(), "Authority should be user2");
      assert.equal(vaultConfig.vaultId, vaultId3, "Vault ID should be user2-vault-1");
    });

    it("Users can transfer tokens to specific vaults independently", async () => {
      // User1 transfers to vault1
      await program.methods
        .transferIn(new BN((100 * 10 ** decimals).toString()))
        .accounts({
          vaultConfig: vaultConfig1Pda,
          vaultTokenAccount: tokenVault1,
          senderTokenAccount: user1TokenAccount,
          protocolTokenAccount: protocolTokenAccount,
          signer: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // User1 transfers to vault2 
      await program.methods
        .transferIn(new BN((50 * 10 ** decimals).toString()))
        .accounts({
          vaultConfig: vaultConfig2Pda,
          vaultTokenAccount: tokenVault2,
          senderTokenAccount: user1TokenAccount,
          protocolTokenAccount: protocolTokenAccount,
          signer: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // User2 transfers to their vault
      await program.methods
        .transferIn(new BN((75 * 10 ** decimals).toString()))
        .accounts({
          vaultConfig: vaultConfig3Pda,
          vaultTokenAccount: tokenVault3,
          senderTokenAccount: user2TokenAccount,
          protocolTokenAccount: protocolTokenAccount,
          signer: user2.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();

      // Verify balances are independent
      const vault1Balance = await getAccountBalance(tokenVault1);
      const vault2Balance = await getAccountBalance(tokenVault2);
      const vault3Balance = await getAccountBalance(tokenVault3);
      const user1Balance = await getAccountBalance(user1TokenAccount);
      const user2Balance = await getAccountBalance(user2TokenAccount);

      assert.equal(vault1Balance, BigInt(100), "Vault1 should have 100 tokens");
      assert.equal(vault2Balance, BigInt(50), "Vault2 should have 50 tokens");
      assert.equal(vault3Balance, BigInt(75), "Vault3 should have 75 tokens");
      assert.equal(user1Balance, BigInt(350), "User1 should have 350 tokens left"); // 500 - 100 - 50
      assert.equal(user2Balance, BigInt(325), "User2 should have 325 tokens left"); // 400 - 75
    });

    it("Vault funding progress is calculated independently", async () => {
      const vaultConfig1 = await program.account.vaultConfig.fetch(vaultConfig1Pda);
      const vaultConfig2 = await program.account.vaultConfig.fetch(vaultConfig2Pda);
      const vaultConfig3 = await program.account.vaultConfig.fetch(vaultConfig3Pda);

      const vault1Balance = await getAccountBalance(tokenVault1);
      const vault2Balance = await getAccountBalance(tokenVault2);
      const vault3Balance = await getAccountBalance(tokenVault3);

      const progress1 = (vault1Balance * BigInt(100)) / (BigInt(vaultConfig1.targetAmount.toString()) / mintDecimals);
      const progress2 = (vault2Balance * BigInt(100)) / (BigInt(vaultConfig2.targetAmount.toString()) / mintDecimals);
      const progress3 = (vault3Balance * BigInt(100)) / (BigInt(vaultConfig3.targetAmount.toString()) / mintDecimals);

      console.log(`Vault1 progress: ${progress1}% (${vault1Balance} of ${BigInt(vaultConfig1.targetAmount.toString()) / mintDecimals} tokens)`);
      console.log(`Vault2 progress: ${progress2}% (${vault2Balance} of ${BigInt(vaultConfig2.targetAmount.toString()) / mintDecimals} tokens)`);
      console.log(`Vault3 progress: ${progress3}% (${vault3Balance} of ${BigInt(vaultConfig3.targetAmount.toString()) / mintDecimals} tokens)`);

      assert.equal(progress1, BigInt(50), "Vault1 should be 50% funded");
      assert.equal(progress2, BigInt(33), "Vault2 should be ~33% funded"); // 50/150 * 100 = 33.33
      assert.equal(progress3, BigInt(37), "Vault3 should be ~37% funded"); // 75/200 * 100 = 37.5
    });

    it("Cannot access wrong vault with different vault ID", async () => {
      try {
        // Try to transfer from vault1 using vault2's config - should fail
        await program.methods
          .transferOut(new BN((10 * 10 ** decimals).toString()))
          .accounts({
            vaultConfig: vaultConfig2Pda, // Wrong config
            vaultTokenAccount: tokenVault1, // Wrong vault for this config
            senderTokenAccount: user1TokenAccount,
            protocolTokenAccount: protocolTokenAccount,
            signer: provider.wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        assert.fail("Should have failed due to PDA mismatch");
      } catch (error: any) {
        assert.ok(
          error.toString().includes("seeds constraint was violated") ||
          error.toString().includes("ConstraintSeeds"),
          `Expected seeds constraint error, got: ${error.toString()}`
        );
      }
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
