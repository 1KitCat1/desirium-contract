use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("6kSShQybH6Qw7NdC7aimBtbZ6i14bQ6oyCVesttrpPr5");

#[program]
pub mod desirium_contract {
    use super::*;

    pub fn create_wishlist(
        ctx: Context<CreateWishlist>,
        ipfs_url: String,
    ) -> Result<()> {
        let wishlist = &mut ctx.accounts.wishlist;
        wishlist.authority = ctx.accounts.authority.key();
        wishlist.ipfs_url = ipfs_url;
        wishlist.created_at = Clock::get()?.unix_timestamp;
        wishlist.total_donations = 0;
        
        msg!("Created wishlist: {}", wishlist.key());
        Ok(())
    }

    pub fn donate(
        ctx: Context<Donate>,
        amount: u64,
    ) -> Result<()> {
        // Transfer tokens from donor to platform
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.donor_token_account.to_account_info(),
                to: ctx.accounts.platform_token_account.to_account_info(), // TODO: Check
                authority: ctx.accounts.donor.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        // Update wishlist total donations
        let wishlist = &mut ctx.accounts.wishlist;
        wishlist.total_donations = wishlist.total_donations.checked_add(amount)
            .ok_or(DesiriumError::Overflow)?;

        msg!("Donation received: {} tokens", amount);
        Ok(())
    }
}

#[account]
pub struct Wishlist {
    pub authority: Pubkey,      // Creator of the wishlist
    pub ipfs_url: String,       // IPFS URL for wishlist metadata
    pub created_at: i64,        // Timestamp of creation
    pub total_donations: u64,   // Total donations received in USDC
}

#[derive(Accounts)]
pub struct CreateWishlist<'info> {
    #[account(
        init,
        seeds = [b"wishlist", authority.key().as_ref()],
        bump,
        payer = authority,
        space = 8 + // discriminator
            32 +    // authority
            60 +    // ipfs_url (max length)
            8 +     // created_at
            8       // total_donations
    )]
    pub wishlist: Account<'info, Wishlist>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Donate<'info> {
    #[account(mut)]
    pub wishlist: Account<'info, Wishlist>,
    
    #[account(mut)]
    pub donor: Signer<'info>,
    
    #[account(
        mut,
        constraint = donor_token_account.owner == donor.key()
    )]
    pub donor_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = platform_token_account.owner == platform.key()
    )]
    pub platform_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: This is the platform's token account
    #[account(mut)]
    pub platform: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// Error codes
#[error_code]
pub enum DesiriumError {
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Invalid swap parameters")]
    InvalidSwapParameters,
    #[msg("Arithmetic overflow")]
    Overflow,
}
