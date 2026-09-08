CREATE TABLE `flow_payload_size` (
	`flow_id` text NOT NULL,
	`run_id` text NOT NULL,
	`pass` text NOT NULL,
	`http_status` integer,
	`total_bytes` integer,
	`estimated_series` integer,
	`duration_ms` integer,
	`measured_at` text NOT NULL,
	PRIMARY KEY(`flow_id`, `run_id`, `pass`)
);
--> statement-breakpoint
CREATE INDEX `flow_payload_size_bytes_idx` ON `flow_payload_size` (`total_bytes`);