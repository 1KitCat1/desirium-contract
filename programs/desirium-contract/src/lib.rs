use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("6kSShQybH6Qw7NdC7aimBtbZ6i14bQ6oyCVesttrpPr5");

#[program]
pub mod desirium_contract {
    use super::*;

    // Existing create_wishlist unchanged
    pub fn create_wishlist(ctx: Context<CreateWishlist>, ipfs_url: String, token_mint: Pubkey) -> Result<()> {
        let wishlist = &mut ctx.accounts.wishlist;
        wishlist.authority = ctx.accounts.authority.key();
        wishlist.ipfs_url = ipfs_url;
        wishlist.created_at = Clock::get()?.unix_timestamp;
        wishlist.total_donations = 0;
        wishlist.token_mint = token_mint;

        msg!("Created wishlist: {}", wishlist.key());
        Ok(())
    }

    // Existing donate unchanged
    pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.donor_token_account.mint == ctx.accounts.wishlist.token_mint,
            DesiriumError::InvalidToken
        );

        let donor_token_account = &ctx.accounts.donor_token_account;
        if donor_token_account.amount < amount {
            return Err(DesiriumError::InsufficientBalance.into());
        }

        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.donor_token_account.to_account_info(),
                to: ctx.accounts.platform_token_account.to_account_info(),
                authority: ctx.accounts.donor.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        let wishlist = &mut ctx.accounts.wishlist;
        wishlist.total_donations = wishlist
            .total_donations
            .checked_add(amount)
            .ok_or(DesiriumError::Overflow)?;

        msg!("Donation received: {} tokens", amount);
        Ok(())
    }

    // New: Initialize vault token account owned by authority for withdrawals
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        // No extra logic needed, Anchor creates the vault token account
        msg!("Vault token account initialized: {}", ctx.accounts.vault.key());
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        if vault.amount < amount {
            return Err(DesiriumError::InsufficientBalance.into());
        }
    
        // PDA seeds for vault authority
        let seeds = &[
            b"vault",
            ctx.accounts.authority.key.as_ref(),
            &[ctx.bumps.vault],
        ];
        let signer_seeds = &[seeds.as_slice()];
    
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: vault.to_account_info(),
                to: ctx.accounts.authority_token_account.to_account_info(),
                authority: vault.to_account_info(), // PDA is the authority
            },
            signer_seeds,
        );
    
        token::transfer(cpi_ctx, amount)?;
        Ok(())
    }
    
    
}

#[account]
pub struct Wishlist {
    pub authority: Pubkey,
    pub ipfs_url: String,
    pub created_at: i64,
    pub total_donations: u64,
    pub token_mint: Pubkey,
}

#[derive(Accounts)]
pub struct CreateWishlist<'info> {
    #[account(
        init,
        seeds = [b"wishlist", authority.key().as_ref()],
        bump,
        payer = authority,
        space = 8 + 32 + 60 + 8 + 8 + 32
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
        constraint = donor_token_account.owner == donor.key(),
        constraint = donor_token_account.mint == wishlist.token_mint
    )]
    pub donor_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = platform_token_account.owner == platform.key(),
        constraint = platform_token_account.mint == wishlist.token_mint
    )]
    pub platform_token_account: Account<'info, TokenAccount>,

    /// CHECK: Platform account owner; only checked for ownership of platform_token_account
    #[account(mut)]
    pub platform: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// New context to initialize vault token account owned by authority
#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = vault_authority, // Use PDA as authority
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"vault", authority.key().as_ref()],
        bump,
    )]
    /// CHECK: PDA used as token account authority
    pub vault_authority: AccountInfo<'info>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}


#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"vault", authority.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = vault, // PDA is the authority
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = authority,
    )]
    pub authority_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}


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
    #[msg("Token mismatch: This wishlist only accepts a specific token")]
    InvalidToken,
}
