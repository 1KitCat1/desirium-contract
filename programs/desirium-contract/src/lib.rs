use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount, Transfer};

declare_id!("6kSShQybH6Qw7NdC7aimBtbZ6i14bQ6oyCVesttrpPr5");

#[program]
pub mod token_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, target_amount: u64) -> Result<()> {
        let config = &mut ctx.accounts.vault_config;
        config.token_mint = ctx.accounts.token_mint.key();
        config.target_amount = target_amount;
        config.bump = ctx.bumps.vault_config;
        Ok(())
    }

    pub fn transfer_in(ctx: Context<TransferAccounts>, amount: u64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.sender_token_account.mint,
            ctx.accounts.vault_config.token_mint,
            VaultError::InvalidMint
        );

        let cpi_accounts = Transfer {
            from: ctx.accounts.sender_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.signer.to_account_info(),
        };

        anchor_spl::token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            amount,
        )
    }

    pub fn transfer_out(ctx: Context<TransferAccounts>, amount: u64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.sender_token_account.mint,
            ctx.accounts.vault_config.token_mint,
            VaultError::InvalidMint
        );

        let bump = ctx.accounts.vault_config.bump;
        let seeds = &[b"vault_config".as_ref(), &[bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.sender_token_account.to_account_info(),
            authority: ctx.accounts.vault_config.to_account_info(),
        };

        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer,
            ),
            amount,
        )
    }
}

#[account]
pub struct VaultConfig {
    pub token_mint: Pubkey,
    pub target_amount: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = signer,
        seeds = [b"vault_config"],
        bump,
        space = 8 + 32 + 8 + 1 // discriminator + pubkey + u64 + u8
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(
        init,
        payer = signer,
        seeds = [b"token_vault", token_mint.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = vault_config,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct TransferAccounts<'info> {
    #[account(
        seeds = [b"vault_config"],
        bump = vault_config.bump,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(
        mut,
        seeds = [b"token_vault", vault_config.token_mint.as_ref()],
        bump,
        token::mint = vault_config.token_mint,
        token::authority = vault_config,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = sender_token_account.mint == vault_config.token_mint
    )]
    pub sender_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum VaultError {
    #[msg("Token mint mismatch with vault configuration")]
    InvalidMint,
}
