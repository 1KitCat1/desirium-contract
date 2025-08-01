use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address,
    token::{Mint, Token, TokenAccount, Transfer},
};

declare_id!("6kSShQybH6Qw7NdC7aimBtbZ6i14bQ6oyCVesttrpPr5");

// IMPORTANT: change to the actual protocol owner before deploying
pub const PROTOCOL_OWNER: &str = "55oBBfLE4LPAYQthXYkfNN5WZBzD4f5EfpPYkTMuP6RU";
pub const COMMISSION_BPS_ABOVE_TARGET: u64 = 100; // 1% (100 basis points)
pub const COMMISSION_BPS_BELOW_TARGET: u64 = 500; // 5% (500 basis points)
pub const BPS_DENOMINATOR: u64 = 10_000; // BPS - basis points

#[program]
pub mod token_vault {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        vault_id: String,
        target_amount: u64,
        ipfs_link: String,
    ) -> Result<()> {
        let config = &mut ctx.accounts.vault_config;
        config.authority = ctx.accounts.signer.key();
        config.vault_id = vault_id;
        config.token_mint = ctx.accounts.token_mint.key();
        config.target_amount = target_amount;
        config.bump = ctx.bumps.vault_config;
        require!(ipfs_link.len() <= 200, VaultError::IpfsLinkTooLong);
        config.ipfs_link = ipfs_link;
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

    pub fn transfer_out(ctx: Context<TransferOut>, amount: u64) -> Result<()> {
        // Only the vault creator can transfer out
        require_keys_eq!(
            ctx.accounts.signer.key(),
            ctx.accounts.vault_config.authority,
            VaultError::UnauthorizedWithdrawal
        );

        require_keys_eq!(
            ctx.accounts.sender_token_account.mint,
            ctx.accounts.vault_config.token_mint,
            VaultError::InvalidMint
        );

        // Get current vault balance
        let vault_balance = ctx.accounts.vault_token_account.amount;

        // Choose commission rate
        let commission_bps = if vault_balance >= ctx.accounts.vault_config.target_amount {
            COMMISSION_BPS_ABOVE_TARGET // 1%
        } else {
            COMMISSION_BPS_BELOW_TARGET // 5%
        };

        // TODO: remove unwraps (ALL)
        // Calculate commission and user amount
        let commission = amount
            .checked_mul(commission_bps)
            .unwrap()
            .checked_div(BPS_DENOMINATOR)
            .unwrap();
        let user_amount = amount.checked_sub(commission).unwrap();

        let authority = ctx.accounts.vault_config.authority;
        let vault_id = ctx.accounts.vault_config.vault_id.as_bytes();
        let bump = ctx.accounts.vault_config.bump;
        let seeds = &[
            b"vault_config".as_ref(),
            authority.as_ref(),
            vault_id,
            &[bump],
        ];
        let signer = &[&seeds[..]];

        // Transfer commission to protocol
        let protocol_token_account = ctx.accounts.protocol_token_account.to_account_info();
        let cpi_accounts_commission = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: protocol_token_account,
            authority: ctx.accounts.vault_config.to_account_info(),
        };
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts_commission,
                signer,
            ),
            commission,
        )?;

        // Transfer the rest to the user (vault creator)
        let cpi_accounts_user = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.sender_token_account.to_account_info(),
            authority: ctx.accounts.vault_config.to_account_info(),
        };
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts_user,
                signer,
            ),
            user_amount,
        )?;

        Ok(())
    }

    pub fn get_ipfs_link(ctx: Context<GetIpfsLink>) -> Result<String> {
        Ok(ctx.accounts.vault_config.ipfs_link.clone())
    }
}

#[account]
#[derive(InitSpace)]
pub struct VaultConfig {
    pub authority: Pubkey,
    #[max_len(32)]
    pub vault_id: String,
    pub token_mint: Pubkey,
    pub target_amount: u64,
    pub bump: u8,
    #[max_len(100)]
    pub ipfs_link: String,
}

#[derive(Accounts)]
#[instruction(vault_id: String)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = signer,
        seeds = [b"vault_config", signer.key().as_ref(), vault_id.as_bytes()],
        bump,
        space = 8 + VaultConfig::INIT_SPACE
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(
        init,
        payer = signer,
        seeds = [b"token_vault", signer.key().as_ref(), vault_id.as_bytes(), token_mint.key().as_ref()],
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
}

#[derive(Accounts)]
#[instruction(vault_id: String)]
pub struct GetIpfsLink<'info> {
    #[account(
        seeds = [b"vault_config", vault_config.authority.as_ref(), vault_id.as_bytes()], 
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,
}

#[derive(Accounts)]
pub struct TransferAccounts<'info> {
    #[account(
        seeds = [b"vault_config", vault_config.authority.as_ref(), vault_config.vault_id.as_bytes()],
        bump = vault_config.bump,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(
        mut,
        seeds = [b"token_vault", vault_config.authority.as_ref(), vault_config.vault_id.as_bytes(), vault_config.token_mint.as_ref()],
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

    /// CHECK: This is a constant protocol-owned token account
    #[account(
        mut,
        address = get_associated_token_address(
            &Pubkey::from_str(PROTOCOL_OWNER).unwrap(),
            &vault_config.token_mint
        )
    )]
    pub protocol_token_account: AccountInfo<'info>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TransferOut<'info> {
    #[account(
        seeds = [b"vault_config", vault_config.authority.as_ref(), vault_config.vault_id.as_bytes()],
        bump = vault_config.bump,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(
        mut,
        seeds = [b"token_vault", vault_config.authority.as_ref(), vault_config.vault_id.as_bytes(), vault_config.token_mint.as_ref()],
        bump,
        token::mint = vault_config.token_mint,
        token::authority = vault_config,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = sender_token_account.mint == vault_config.token_mint,
        constraint = sender_token_account.owner == vault_config.authority @ VaultError::UnauthorizedWithdrawal
    )]
    pub sender_token_account: Account<'info, TokenAccount>,

    /// CHECK: This is a constant protocol-owned token account
    #[account(
        mut,
        address = get_associated_token_address(
            &Pubkey::from_str(PROTOCOL_OWNER).unwrap(),
            &vault_config.token_mint
        )
    )]
    pub protocol_token_account: AccountInfo<'info>,

    #[account(
        mut,
        constraint = signer.key() == vault_config.authority @ VaultError::UnauthorizedWithdrawal
    )]
    pub signer: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum VaultError {
    #[msg("Token mint mismatch with vault configuration")]
    InvalidMint,
    #[msg("IPFS link too long")]
    IpfsLinkTooLong,
    #[msg("Only the vault creator can withdraw funds")]
    UnauthorizedWithdrawal,
}
