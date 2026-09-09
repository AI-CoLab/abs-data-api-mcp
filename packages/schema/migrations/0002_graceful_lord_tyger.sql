CREATE TABLE `refresh_check` (
	`id` text PRIMARY KEY NOT NULL,
	`checked_at` text NOT NULL,
	`slice` integer NOT NULL,
	`slices` integer NOT NULL,
	`flows_listed` integer NOT NULL,
	`flows_checked` integer NOT NULL,
	`new_flows` text NOT NULL,
	`removed_flows` text NOT NULL,
	`reversioned_flows` text NOT NULL,
	`marginal_changes` text NOT NULL,
	`errors` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `refresh_check_time_idx` ON `refresh_check` (`checked_at`);