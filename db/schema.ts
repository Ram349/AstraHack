import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const players = sqliteTable('race_players', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), token: text('token').notNull(),
  room: text('room').notNull(), x: real('x').notNull(), y: real('y').notNull(),
  z: real('z').notNull(), rotation: real('rotation').notNull(), updated: integer('updated').notNull(),
}, (table) => [index('idx_players_room_updated').on(table.room, table.updated), index('idx_players_updated').on(table.updated)]);

export const quotas = sqliteTable('race_quotas', {
  key: text('key').primaryKey(), count: integer('count').notNull(), expires: integer('expires').notNull(),
}, (table) => [index('idx_quotas_expires').on(table.expires)]);
