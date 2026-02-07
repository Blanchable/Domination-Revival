import { EmbedBuilder } from 'discord.js';

export function getHowToPlayEmbeds(): EmbedBuilder[] {
  const overview = new EmbedBuilder()
    .setTitle('How to Play - Overview')
    .setColor(0x5865f2)
    .setDescription(
      '**Domination Revival** is a daily-turn grand strategy game.\n\n' +
      'Each day, you submit orders (move troops, build, recruit, etc). ' +
      'At the daily tick time, all orders resolve simultaneously.\n\n' +
      '**Goal:** Conquer provinces, build your economy, form alliances, ' +
      'and eliminate your opponents!'
    );

  const getting_started = new EmbedBuilder()
    .setTitle('Getting Started')
    .setColor(0x00ae86)
    .setDescription(
      '1. Use `/join` in the lobby to enter the game\n' +
      '2. You\'ll get a private orders channel\n' +
      '3. During the draft, use `/pick <province_id>` to choose provinces\n' +
      '4. After the draft, submit orders each day before the tick\n\n' +
      '**Starting Resources:** 300 Gold, 300 Food, 80 Regular Troops'
    );

  const commands = new EmbedBuilder()
    .setTitle('Key Commands')
    .setColor(0xffd700)
    .addFields(
      { name: 'Information', value: '`/my` - Your status\n`/holdings` - Your provinces\n`/map <id>` - Province info\n`/orders` - Pending orders' },
      { name: 'Orders', value: '`/move <from> <to> <troops>` - Move troops\n`/build <province> <type>` - Build\n`/upgrade <province> <type>` - Upgrade\n`/recruit <province> <regulars> <mercs>` - Recruit' },
      { name: 'Alliance', value: '`/alliance invite @user` - Invite\n`/alliance accept <id>` - Accept\n`/send @ally <gold> <food>` - Donate\n`/support @ally <troops>` - Send troops' },
      { name: 'Pope', value: '`/pope cast <ability> <target>` - Use ability\n`/pope info` - View Pope status' },
    );

  const combat = new EmbedBuilder()
    .setTitle('Combat')
    .setColor(0xff4444)
    .setDescription(
      'Battles occur when troops enter an enemy province or multiple armies meet.\n\n' +
      '**System:** Units fight in batches of 10v10. Each pair rolls 1d6 - higher kills the other. ' +
      'Ties re-roll. Survivors continue until one side is gone.\n\n' +
      '**Modifiers:**\n' +
      '- Fortress building: +1/+2/+3/+4 for defender\n' +
      '- Pope Blessing: +1 for blessed player\n' +
      '- Buildings are destroyed when a province is captured'
    );

  return [overview, getting_started, commands, combat];
}
