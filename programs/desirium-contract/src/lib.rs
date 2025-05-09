use anchor_lang::prelude::*;

declare_id!("6kSShQybH6Qw7NdC7aimBtbZ6i14bQ6oyCVesttrpPr5");

#[program]
pub mod desirium_contract {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
