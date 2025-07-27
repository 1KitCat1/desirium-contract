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

  describe("token_vault", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.TokenVault as Program<TokenVault>;

    const decimals = 9;
    const mintDecimals = BigInt(10 ** decimals);
    const targetAmount = BigInt(200 * 10 ** decimals);
    const ipfsStr = "ipfs://HAsh";
    let mint: PublicKey;
    let vaultConfigPda: PublicKey;
    let tokenVault: PublicKey;
    let user1: Keypair;
    let user2: Keypair;
    let user1TokenAccount: PublicKey;
    let user2TokenAccount: PublicKey;
    let protocolTokenAccount: PublicKey;

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
      await mintTo(mint, user1TokenAccount, 200 * 10 ** decimals, provider);
      await mintTo(mint, user2TokenAccount, 300 * 10 ** decimals, provider);

      // Create protocol token account using the same mint
      protocolTokenAccount = getAssociatedTokenAddressSync(
        mint, // Use the same mint as the vault
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

    it("Initialize vault with target amount", async () => {
      // Use BigNumber for the initialize call with the target amount
      const targetAmountBN = new BN(targetAmount.toString());

      const tx = await program.methods
        .initialize(targetAmountBN, ipfsStr)
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
      const vaultConfigAccount = await program.account.vaultConfig.fetch(vaultConfigPda);
      const ipfsLink = vaultConfigAccount.ipfsLink;
      console.log("IPFS link:", ipfsLink);

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
      const amount = new BN((100 * 10 ** decimals).toString());

      await program.methods
        .transferIn(amount)
        .accounts({
          vaultConfig: vaultConfigPda,
          vaultTokenAccount: tokenVault,
          senderTokenAccount: user1TokenAccount,
          protocolTokenAccount: protocolTokenAccount,
          signer: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      const userBalance = await getAccountBalance(user1TokenAccount);
      const vaultBalance = await getAccountBalance(tokenVault);

      // NOTE: USER 200 -> 100
      // NOTE: VAULT 0 -> 100
      assert.equal(userBalance, BigInt(100), "User1 should have 100 tokens left");
      assert.equal(vaultBalance, BigInt(100), "Vault should have 100 tokens");
    });

    it("User2 transfers tokens into vault", async () => {
      // Convert amount to Anchor's BN type
      const amount = new BN((1 * 10 ** decimals).toString());

      await program.methods
        .transferIn(amount)
        .accounts({
          vaultConfig: vaultConfigPda,
          vaultTokenAccount: tokenVault,
          senderTokenAccount: user2TokenAccount,
          protocolTokenAccount: protocolTokenAccount,
          signer: user2.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();

      const userBalance = await getAccountBalance(user2TokenAccount);
      const vaultBalance = await getAccountBalance(tokenVault);

      // NOTE: USER2: 300 -> - 1 = 299
      // NOTE: VAULT: 100 -> + 1 = 101
      assert.equal(userBalance, BigInt(299), "User2 should have 99 tokens left");
      assert.equal(vaultBalance, BigInt(101), "Vault should have 2 tokens");
    });

    it("Checks funding progress against target", async () => {
      const vaultBalance = await getAccountBalance(tokenVault);
      const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);

      const targetAmountTokens =
        BigInt(vaultConfig.targetAmount.toString()) / mintDecimals;
      const progress = (vaultBalance * BigInt(100)) / targetAmountTokens;

      console.log(
        `Funding progress: ${progress}% (${vaultBalance} of ${targetAmountTokens} tokens)`
      );

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
      const wrongTokenAccount = await createTokenAccountIfNeeded(
        wrongMint,
        user1.publicKey,
        provider
      );

      // Mint tokens to wrong token account
      await mintTo(wrongMint, wrongTokenAccount, 100 * 10 ** decimals, provider);

      // Attempt transferIn with wrong token account - should fail constraint check
      try {
        // Convert amount to Anchor's BN type
        const amount = new BN((1 * 10 ** decimals).toString());

        await program.methods
          .transferIn(amount)
          .accounts({
            vaultConfig: vaultConfigPda,
            vaultTokenAccount: tokenVault,
            senderTokenAccount: wrongTokenAccount,
            protocolTokenAccount: protocolTokenAccount,
            signer: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();

        assert.fail(
          "transferIn should have failed due to mint mismatch constraint"
        );
      } catch (error: any) {
        const errMsg = error.error?.msg ?? error.toString();
        // Anchor constraint raw error code is 2003
        assert.ok(
          errMsg.includes("A raw constraint was violated") ||
            errMsg.includes("ConstraintRaw"),
          `Expected raw constraint error, got: ${errMsg}`
        );
      }
    });

    it("Transfer out tokens (target amount NOT reached, 5% commision)", async () => {
      // Convert amount to Anchor's BN type
      const amount = new BN((100 * 10 ** decimals).toString());

      await program.methods
        .transferOut(amount)
        .accounts({
          vaultConfig: vaultConfigPda,
          vaultTokenAccount: tokenVault,
          senderTokenAccount: user1TokenAccount,
          protocolTokenAccount: protocolTokenAccount,
          signer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const userBalance = await getAccountBalance(user1TokenAccount);
      const vaultBalance = await getAccountBalance(tokenVault);
      const protocolBalance = await getAccountBalance(protocolTokenAccount);
      // NOTE: because of the commision user will receive back less tokens (100 * 5% = 5)
      // NOTE: USER #1: 100 -> + 100 - 5 = 195
      // NOTE: VAULT: 101 -> - 100 = 1
      // NOTE: PROTOCOL: 0 -> + 5 = 5
      assert.equal(userBalance, BigInt(195), "User should have 195 tokens");
      assert.equal(vaultBalance, BigInt(1), "Vault should have 1 token left");
      assert.equal(protocolBalance, BigInt(5), "Protocol should have 5 tokens");
    });


    it("Transfer out tokens (target amount reached, 1% commision)", async () => {
      // Convert amount to Anchor's BN type
      const amount = new BN((200 * 10 ** decimals).toString());

      await program.methods
        .transferIn(amount)
        .accounts({
          vaultConfig: vaultConfigPda,
          vaultTokenAccount: tokenVault,
          senderTokenAccount: user2TokenAccount,
          protocolTokenAccount: protocolTokenAccount,
          signer: user2.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();

      let userBalance = await getAccountBalance(user2TokenAccount);
      let vaultBalance = await getAccountBalance(tokenVault);
      let protocolBalance = await getAccountBalance(protocolTokenAccount);

      // NOTE: USER #2: 299 -> - 200 =  99
      // NOTE: VAULT: 1 -> + 200 = 201
      // NOTE: PROTOCOL: 5 (NO CHANGE)
      assert.equal(userBalance, BigInt(99), "User should have 99 tokens");
      assert.equal(vaultBalance, BigInt(201), "Vault should have 201 tokens left");
      assert.equal(protocolBalance, BigInt(5), "Protocol should have 5 tokens");


      await program.methods
        .transferOut(amount)
        .accounts({
          vaultConfig: vaultConfigPda,
          vaultTokenAccount: tokenVault,
          senderTokenAccount: user2TokenAccount,
          protocolTokenAccount: protocolTokenAccount,
          signer: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();



      userBalance = await getAccountBalance(user2TokenAccount);
      vaultBalance = await getAccountBalance(tokenVault);
      protocolBalance = await getAccountBalance(protocolTokenAccount);
      // NOTE: because of the commision user will receive back less tokens (200 * 1% = 2)
      // NOTE: USER #2: 99 -> + 200 - 2 = 297
      // NOTE: VAULT: 201 -> - 200 = 1
      // NOTE: PROTOCOL: 5 -> + 2 = 7
      assert.equal(userBalance, BigInt(297), "User should have 297 tokens");
      assert.equal(vaultBalance, BigInt(1), "Vault should have 1 token left");
      assert.equal(protocolBalance, BigInt(7), "Protocol should have 7 tokens");
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
