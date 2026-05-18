import { upsertUser } from '../../services/userService.js';
import { countWallets } from '../../services/walletService.js';
import { welcome } from '../templates.js';
import { mainMenu } from '../keyboards.js';

export async function handleStart(ctx) {
  const { id, username, first_name } = ctx.from;
  const { isNew } = upsertUser({ tg_id: id, username, first_name });
  const hasWallets = countWallets(id) > 0;
  await ctx.replyWithMarkdownV2(
    welcome(isNew, first_name),
    mainMenu(hasWallets)
  );
}
