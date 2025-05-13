# Desirium Token Vault

A Solana program for managing token vaults with funding target tracking and protocol commission functionality.

## Overview

Desirium Token Vault is a Solana smart contract built with Anchor that allows users to deposit and withdraw tokens from a secure vault. The contract supports setting funding targets and implements a protocol fee on withdrawals to sustain the ecosystem.

## Features

- **Vault Initialization**: Create a vault with a specified funding target for any SPL token
- **Token Deposits**: Deposit tokens into the vault from any compatible token account
- **Token Withdrawals**: Withdraw tokens with automatic protocol fee handling (1% commission)
- **Target Amount Tracking**: Monitor progress towards funding goals

## Technical Requirements

- [Solana CLI](https://docs.solanalabs.com/cli/install) (tested with 2.1.21)
- [Rust](https://www.rust-lang.org/tools/install) (tested with 1.86.0)
- [Anchor](https://www.anchor-lang.com/docs/installation) (tested with v0.31.1)
- [Node.js](https://nodejs.org/) (tested with v20.18.3)
- [Yarn](https://yarnpkg.com/getting-started/install) (tested with v1.22.22)

## Installation

1. Clone the repository:
   ```bash
   git clone // repository link
   cd desirium-contract
   ```

2. Install dependencies:
   ```bash
   yarn install
   ```

3. Build the program:
   ```bash
   anchor build
   ```

## Deployment

### Local Development

1. Start a local Solana validator:
   ```bash
   solana-test-validator
   ```

2. Deploy the program:
   ```bash
   anchor deploy
   ```

3. Run tests:
   ```bash
   anchor test
   ```

### Devnet/Mainnet Deployment

1. Configure your Solana CLI for the target network:
   ```bash
   solana config set --url devnet  # or mainnet-beta
   ```

2. Update the `Anchor.toml` file with your program ID and desired network.

3. Deploy to the network:
   ```bash
   anchor deploy
   ```

## Usage

### Initializing a Vault

```typescript
// Create a vault for a specific token with a target funding amount
await program.methods
  .initialize(new anchor.BN(targetAmount))
  .accounts({
    vaultConfig: vaultConfigPda,
    vaultTokenAccount: tokenVault,
    tokenMint: mint,
    signer: wallet.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

### Depositing Tokens

```typescript
// Deposit tokens into the vault
await program.methods
  .transferIn(new anchor.BN(amount))
  .accounts({
    vaultConfig: vaultConfigPda,
    vaultTokenAccount: tokenVault,
    senderTokenAccount: userTokenAccount,
    protocolTokenAccount: protocolTokenAccount,
    signer: wallet.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

### Withdrawing Tokens

```typescript
// Withdraw tokens from the vault (includes 1% protocol fee)
await program.methods
  .transferOut(new anchor.BN(amount))
  .accounts({
    vaultConfig: vaultConfigPda,
    vaultTokenAccount: tokenVault,
    senderTokenAccount: userTokenAccount,
    protocolTokenAccount: protocolTokenAccount,
    signer: wallet.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

## Token Vault Architecture

The program uses three primary accounts:

1. **Vault Config**: Stores information about the vault including the token mint and target amount
2. **Token Vault Account**: The actual SPL token account that holds the deposited tokens
3. **Protocol Fee Account**: Associated token account for the protocol owner that receives the withdrawal fees

PDAs (Program Derived Addresses) are used for secure, deterministic account creation:
- Vault Config: `["vault_config"]`
- Token Vault: `["token_vault", token_mint]`

## Protocol Fees

The contract implements a 1% fee on all withdrawals to sustain the protocol. This fee is automatically sent to the protocol owner's associated token account during withdrawal operations.

