# Desirium Smart Contract

A Solana smart contract for creating and managing wishlists that accept token donations from users.

## Overview

Desirium is a decentralized protocol that allows users to create wishlists and receive token donations. Each wishlist is associated with an IPFS URL that contains metadata about the wishlist, and accepts donations in a specific token specified during creation.

## Smart Contract Logic

The Desirium contract has the following key components:

1. **Wishlist Account**: Stores information about a wishlist including:
   - Authority (creator/owner)
   - IPFS URL for the wishlist metadata
   - Creation timestamp
   - Total donations received
   - Token mint address that the wishlist accepts

2. **Platform Account**: Acts as an intermediary to collect tokens from donors before they are sent to the wishlist owner.

## Contract Functions

### Create Wishlist
```rust
pub fn create_wishlist(ctx: Context<CreateWishlist>, ipfs_url: String, token_mint: Pubkey) -> Result<()>
```
Creates a new wishlist with the specified IPFS URL and token mint. The creator becomes the authority/owner of the wishlist.

### Donate
```rust
pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()>
```
Allows users to donate tokens to a wishlist. The function:
- Verifies that the token being donated matches the wishlist's accepted token (*token_mint* parameter)
- Checks that the donor has sufficient balance
- Transfers tokens from the donor to the platform account
- Updates the wishlist's total donation count

## Account Structures

### Wishlist Account
```rust
pub struct Wishlist {
    pub authority: Pubkey,    // Creator of the wishlist
    pub ipfs_url: String,     // IPFS URL for wishlist metadata
    pub created_at: i64,      // Timestamp of creation
    pub total_donations: u64, // Total donations received in tokens
    pub token_mint: Pubkey,   // Token mint that this wishlist accepts
}
```

### CreateWishlist Context
Defines the accounts needed for creating a wishlist:
- `wishlist`: The new wishlist account (PDA)
- `authority`: The signer creating the wishlist
- `system_program`: Required for creating the account

### Donate Context
Defines the accounts needed for donating:
- `wishlist`: The wishlist receiving the donation
- `donor`: The signer donating tokens
- `donor_token_account`: The donor's token account
- `platform_token_account`: The platform's token account
- `platform`: The platform account
- `token_program`: The SPL Token program
- `associated_token_program`: The SPL Associated Token program
- `system_program`: The System program

## Error Handling

The contract defines several custom error types:
- `InvalidTokenAccount`: When a token account is invalid
- `InsufficientBalance`: When the donor has insufficient tokens
- `InvalidSwapParameters`: When swap parameters are invalid
- `Overflow`: When arithmetic overflow occurs
- `InvalidToken`: When trying to donate a token that doesn't match the wishlist's accepted token

## Testing

The tests cover the following scenarios:
1. Creating a wishlist with a specific token
2. Donating tokens to a wishlist
3. Ensuring only the correct token can be donated

## Getting Started

### Prerequisites
- Rust
- Solana CLI
- Anchor Framework
- Node.js and yarn/npm

### Building the Contract
```bash
# Clone the repository
git clone (repo address)
cd desirium-contract

# Install dependencies
yarn
# or 
npm install

# Build the contract
anchor build
```

### Running Tests
```bash
# Run the tests
anchor test
```

### Deploying to Devnet
```bash
# Set Solana to devnet
solana config set --url devnet

# Deploy the program
anchor deploy

# Update the program ID
# After deployment, update the program ID in lib.rs and Anchor.toml
```

## Interacting with the Contract

After deployment, you can interact with the contract using the Anchor client or direct Solana transactions:

```typescript
// Example of creating a wishlist
await program.methods
  .createWishlist(ipfsUrl, tokenMint)
  .accounts({
    wishlist: wishlistPda,
    authority: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([wallet])
  .rpc();

// Example of donating to a wishlist
await program.methods
  .donate(new BN(1000000)) // 1 token with 6 decimals
  .accounts({
    wishlist: wishlistPda,
    donor: wallet.publicKey,
    donorTokenAccount: donorTokenAccount,
    platformTokenAccount: platformTokenAccount,
    platform: platformPublicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([wallet])
  .rpc();
```

## License

[MIT](LICENSE)
