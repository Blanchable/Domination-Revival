import { BotCommand } from '../client';
import { gameCommand } from './game';
import { joinCommand, leaveCommand } from './join';
import { pickCommand } from './pick';
import { myCommand, holdingsCommand, mapInfoCommand } from './info';
import {
  moveCommand,
  buildCommand,
  upgradeCommand,
  recruitCommand,
  ordersCommand,
  cancelCommand,
} from './orders';
import { allianceCommand, sendCommand, supportCommand } from './alliance';
import { popeCommand } from './pope';

export const allCommands: BotCommand[] = [
  gameCommand,
  joinCommand,
  leaveCommand,
  pickCommand,
  myCommand,
  holdingsCommand,
  mapInfoCommand,
  moveCommand,
  buildCommand,
  upgradeCommand,
  recruitCommand,
  ordersCommand,
  cancelCommand,
  allianceCommand,
  sendCommand,
  supportCommand,
  popeCommand,
];
