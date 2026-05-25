import type { PacketRegistry } from '../registry.js';

import { CreateSuccessPacket } from './incoming/create-success-packet.js';
import { FailurePacket } from './incoming/failure-packet.js';
import { EnemyShootPacket } from './incoming/enemyshoot-packet.js';
import { GotoPacket } from './incoming/goto-packet.js';
import { MapInfoPacket } from './incoming/mapinfo-packet.js';
import { NewTickPacket } from './incoming/newtick-packet.js';
import { PingPacket } from './incoming/ping-packet.js';
import { ReconnectPacket } from './incoming/reconnect-packet.js';
import { ServerPlayerShootPacket } from './incoming/serverplayershoot-packet.js';
import { UpdatePacket } from './incoming/update-packet.js';
import { TradeRequestedPacket } from './incoming/trade-requested-packet.js';
import { TradeStartPacket } from './incoming/trade-start-packet.js';
import { TradeChangedPacket } from './incoming/trade-changed-packet.js';
import { TradeAcceptedPacket } from './incoming/trade-accepted-packet.js';
import { TradeDonePacket } from './incoming/trade-done-packet.js';
import { VaultContentPacket } from './incoming/vault-content-packet.js';
import { InvResultPacket } from './incoming/inv-result-packet.js';
import { TextPacket } from './incoming/text-packet.js';
import { NotificationPacket } from './incoming/notification-packet.js';

import { ChangeAllyShootPacket } from './outgoing/change-ally-shoot-packet.js';
import { CreatePacket } from './outgoing/create-packet.js';
import { GotoAckPacket } from './outgoing/gotoack-packet.js';
import { HelloPacket } from './outgoing/hello-packet.js';
import { LoadPacket } from './outgoing/load-packet.js';
import { MovePacket } from './outgoing/move-packet.js';
import { UsePortalPacket } from './outgoing/use-portal-packet.js';
import { PlayerTextPacket } from './outgoing/playertext-packet.js';
import { PongPacket } from './outgoing/pong-packet.js';
import { ShootAckPacket } from './outgoing/shootack-packet.js';
import { UpdateAckPacket } from './outgoing/updateack-packet.js';
import { EscapePacket } from './outgoing/escape-packet.js';
import { RequestTradePacket } from './outgoing/request-trade-packet.js';
import { ChangeTradePacket } from './outgoing/change-trade-packet.js';
import { AcceptTradePacket } from './outgoing/accept-trade-packet.js';
import { CancelTradePacket } from './outgoing/cancel-trade-packet.js';
import { InvSwapPacket } from './outgoing/inv-swap-packet.js';

export const DEFAULT_PACKET_REGISTRY: PacketRegistry = {
  CREATE_SUCCESS: CreateSuccessPacket,
  FAILURE: FailurePacket,
  ENEMYSHOOT: EnemyShootPacket,
  GOTO: GotoPacket,
  MAPINFO: MapInfoPacket,
  NEWTICK: NewTickPacket,
  PING: PingPacket,
  RECONNECT: ReconnectPacket,
  SERVERPLAYERSHOOT: ServerPlayerShootPacket,
  UPDATE: UpdatePacket,
  TRADEREQUESTED: TradeRequestedPacket,
  TRADESTART: TradeStartPacket,
  TRADECHANGED: TradeChangedPacket,
  TRADEACCEPTED: TradeAcceptedPacket,
  TRADEDONE: TradeDonePacket,
  VAULT_UPDATE: VaultContentPacket,
  INVRESULT: InvResultPacket,
  TEXT: TextPacket,
  NOTIFICATION: NotificationPacket,

  CHANGE_ALLYSHOOT: ChangeAllyShootPacket,
  CREATE: CreatePacket,
  GOTOACK: GotoAckPacket,
  HELLO: HelloPacket,
  LOAD: LoadPacket,
  MOVE: MovePacket,
  PLAYERTEXT: PlayerTextPacket,
  PONG: PongPacket,
  SHOOT_ACK: ShootAckPacket,
  UPDATEACK: UpdateAckPacket,
  USEPORTAL: UsePortalPacket,
  ESCAPE: EscapePacket,
  REQUESTTRADE: RequestTradePacket,
  CHANGETRADE: ChangeTradePacket,
  ACCEPTTRADE: AcceptTradePacket,
  CANCELTRADE: CancelTradePacket,
  INVSWAP: InvSwapPacket,
};
