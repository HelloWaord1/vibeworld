import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAuthTools } from '../tools/auth-tools.js';
import { registerNavigationTools } from '../tools/navigation-tools.js';
import { registerChunkTools } from '../tools/chunk-tools.js';
import { registerInventoryTools } from '../tools/inventory-tools.js';
import { registerCombatTools } from '../tools/combat-tools.js';
import { registerSocialTools } from '../tools/social-tools.js';
import { registerEconomyTools } from '../tools/economy-tools.js';
import { registerInfoTools } from '../tools/info-tools.js';
import { registerExchangeTools } from '../tools/exchange-tools.js';
import { registerPlayerShopTools } from '../tools/player-shop-tools.js';
import { registerGovernanceTools } from '../tools/governance-tools.js';
import { registerNationTools } from '../tools/nation-tools.js';
import { registerPveTools } from '../tools/pve-tools.js';
import { registerMonsterTools } from '../tools/monster-tools.js';
import { registerMarketplaceTools } from '../tools/marketplace-tools.js';
import { registerAbilityTools } from '../tools/ability-tools.js';
import { registerLeaderboardTools } from '../tools/leaderboard-tools.js';
import { registerBountyTools } from '../tools/bounty-tools.js';
import { registerMailTools } from '../tools/mail-tools.js';
import { registerAdminTools } from '../tools/admin-tools.js';
import { registerAllianceTools } from '../tools/alliance-tools.js';
import { registerPartyTools } from '../tools/party-tools.js';
import { registerBankTools } from '../tools/bank-tools.js';
import { registerCraftTools } from '../tools/craft-tools.js';
import { registerStockTools } from '../tools/stock-tools.js';
import { registerQuestTools } from '../tools/quest-tools.js';
import { registerSoulTools } from '../tools/soul-tools.js';
import { registerDuelTools } from '../tools/duel-tools.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'VibeWorld',
    version: '0.1.0',
  });

  registerAuthTools(server);
  registerNavigationTools(server);
  registerChunkTools(server);
  registerInventoryTools(server);
  registerCombatTools(server);
  registerSocialTools(server);
  registerEconomyTools(server);
  registerInfoTools(server);
  registerExchangeTools(server);
  registerPlayerShopTools(server);
  registerGovernanceTools(server);
  registerNationTools(server);
  registerPveTools(server);
  registerMonsterTools(server);
  registerMarketplaceTools(server);
  registerAbilityTools(server);
  registerLeaderboardTools(server);
  registerBountyTools(server);
  registerMailTools(server);
  registerAdminTools(server);
  registerAllianceTools(server);
  registerCraftTools(server);
  registerPartyTools(server);
  registerBankTools(server);
  registerStockTools(server);
  registerQuestTools(server);
  registerSoulTools(server);
  registerDuelTools(server);

  return server;
}
