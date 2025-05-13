use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount, Transfer};

declare_id!("6kSShQybH6Qw7NdC7aimBtbZ6i14bQ6oyCVesttrpPr5");

#[program]
pub mod token_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // Initialization logic can be added here if needed.
        Ok(())
    }

    pub fn transfer_in(ctx: Context<TransferAccounts>, amount: u64) -> Result<()> {
        msg!("Token amount transfer in: {}!", amount);

        let cpi_accounts = Transfer {
            from: ctx.accounts.sender_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.signer.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        anchor_spl::token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn transfer_out(ctx: Context<TransferAccounts>, amount: u64) -> Result<()> {
        msg!("Token amount transfer out: {}!", amount);

        let bump = ctx.bumps.token_account_owner_pda;

        let seeds = &[b"token_account_owner_pda".as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.sender_token_account.to_account_info(),
            authority: ctx.accounts.token_account_owner_pda.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        anchor_spl::token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// CHECK: This is a PDA derived with a known seed and bump, used as authority.
    #[account(
        init,
        payer = signer,
        seeds = [b"token_account_owner_pda"],
        bump,
        space = 8
    )]
    pub token_account_owner_pda: AccountInfo<'info>,

    #[account(
        init,
        payer = signer,
        seeds = [b"token_vault", mint_of_token_being_sent.key().as_ref()],
        bump,
        token::mint = mint_of_token_being_sent,
        token::authority = token_account_owner_pda,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub mint_of_token_being_sent: Account<'info, Mint>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct TransferAccounts<'info> {
    /// CHECK: This is a PDA derived with a known seed and bump, used as authority.
    #[account(
        mut,
        seeds = [b"token_account_owner_pda"],
        bump,
    )]
    pub token_account_owner_pda: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"token_vault", mint_of_token_being_sent.key().as_ref()],
        bump,
        token::mint = mint_of_token_being_sent,
        token::authority = token_account_owner_pda,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub sender_token_account: Account<'info, TokenAccount>,

    pub mint_of_token_being_sent: Account<'info, Mint>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}
