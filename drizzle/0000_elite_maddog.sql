CREATE TABLE `race_players` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`token` text NOT NULL,
	`room` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`z` real NOT NULL,
	`rotation` real NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_players_room_updated` ON `race_players` (`room`,`updated`);--> statement-breakpoint
CREATE INDEX `idx_players_updated` ON `race_players` (`updated`);--> statement-breakpoint
CREATE TABLE `race_quotas` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_quotas_expires` ON `race_quotas` (`expires`);