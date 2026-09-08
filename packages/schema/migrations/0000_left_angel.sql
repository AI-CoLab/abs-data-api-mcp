CREATE TABLE `declared_attribute` (
	`flow_id` text NOT NULL,
	`attribute_id` text NOT NULL,
	`relationship` text,
	`assignment_status` text,
	`codelist_id` text,
	PRIMARY KEY(`flow_id`, `attribute_id`),
	FOREIGN KEY (`flow_id`) REFERENCES `declared_flow`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `declared_constraint` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`constraint_type` text,
	`valid_from` text,
	`fetched_at` text
);
--> statement-breakpoint
CREATE INDEX `declared_constraint_flow_idx` ON `declared_constraint` (`flow_id`);--> statement-breakpoint
CREATE TABLE `declared_constraint_value` (
	`constraint_id` text NOT NULL,
	`dimension_id` text NOT NULL,
	`code_id` text NOT NULL,
	`is_included` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`constraint_id`, `dimension_id`, `code_id`),
	FOREIGN KEY (`constraint_id`) REFERENCES `declared_constraint`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `declared_constraint_value_dim_idx` ON `declared_constraint_value` (`constraint_id`,`dimension_id`);--> statement-breakpoint
CREATE TABLE `declared_dimension` (
	`flow_id` text NOT NULL,
	`dimension_id` text NOT NULL,
	`position` integer NOT NULL,
	`dimension_type` text NOT NULL,
	`concept_ref` text,
	`codelist_id` text,
	`codelist_size` integer,
	PRIMARY KEY(`flow_id`, `dimension_id`),
	FOREIGN KEY (`flow_id`) REFERENCES `declared_flow`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `declared_dimension_position_idx` ON `declared_dimension` (`flow_id`,`position`);--> statement-breakpoint
CREATE TABLE `declared_flow` (
	`id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`version` text NOT NULL,
	`name` text,
	`description` text,
	`dsd_ref` text,
	`is_final` integer,
	`is_external_reference` integer,
	`declared_key_count` integer,
	`structure_fetched_at` text
);
--> statement-breakpoint
CREATE INDEX `declared_flow_agency_idx` ON `declared_flow` (`agency_id`);--> statement-breakpoint
CREATE TABLE `delta_finding` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`flow_id` text,
	`dimension_id` text,
	`summary` text NOT NULL,
	`evidence` text,
	`declared_value` real,
	`observed_value` real,
	`detected_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `delta_finding_kind_idx` ON `delta_finding` (`kind`);--> statement-breakpoint
CREATE INDEX `delta_finding_flow_idx` ON `delta_finding` (`flow_id`);--> statement-breakpoint
CREATE INDEX `delta_finding_severity_idx` ON `delta_finding` (`severity`);--> statement-breakpoint
CREATE TABLE `endpoint_check` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`documented_behaviour` text NOT NULL,
	`http_status` integer,
	`verdict` text NOT NULL,
	`detail` text,
	`duration_ms` integer,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `endpoint_check_verdict_idx` ON `endpoint_check` (`verdict`);--> statement-breakpoint
CREATE TABLE `flow_family` (
	`id` text PRIMARY KEY NOT NULL,
	`table_code` text NOT NULL,
	`label` text,
	`member_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `flow_family_member` (
	`family_id` text NOT NULL,
	`flow_id` text NOT NULL,
	`geography_level` text,
	PRIMARY KEY(`family_id`, `flow_id`),
	FOREIGN KEY (`family_id`) REFERENCES `flow_family`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `flow_family_member_flow_idx` ON `flow_family_member` (`flow_id`);--> statement-breakpoint
CREATE TABLE `flow_probe` (
	`flow_id` text NOT NULL,
	`run_id` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`http_status` integer,
	`series_found` integer DEFAULT 0 NOT NULL,
	`bytes_received` integer,
	`split_depth` integer DEFAULT 0 NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL,
	`duration_ms` integer,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`flow_id`, `run_id`),
	FOREIGN KEY (`run_id`) REFERENCES `probe_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `flow_probe_status_idx` ON `flow_probe` (`status`);--> statement-breakpoint
CREATE TABLE `observed_dimension_code` (
	`flow_id` text NOT NULL,
	`dimension_id` text NOT NULL,
	`code_id` text NOT NULL,
	`series_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`flow_id`, `dimension_id`, `code_id`),
	FOREIGN KEY (`flow_id`) REFERENCES `observed_flow`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `observed_dimension_code_reverse_idx` ON `observed_dimension_code` (`dimension_id`,`code_id`);--> statement-breakpoint
CREATE TABLE `observed_flow` (
	`id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`version` text NOT NULL,
	`name` text,
	`series_count` integer DEFAULT 0 NOT NULL,
	`frequencies` text,
	`earliest_period` text,
	`latest_period` text,
	`density_ratio` real,
	`mcp_eligible` integer DEFAULT false NOT NULL,
	`last_probed_at` text
);
--> statement-breakpoint
CREATE INDEX `observed_flow_eligible_idx` ON `observed_flow` (`mcp_eligible`);--> statement-breakpoint
CREATE TABLE `probe_run` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`flows_attempted` integer DEFAULT 0 NOT NULL,
	`flows_succeeded` integer DEFAULT 0 NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `series` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`flow_id` text NOT NULL,
	`key_string` text NOT NULL,
	`freq` text,
	`first_period` text,
	`last_period` text,
	`derived_obs_count` integer,
	`actual_obs_count` integer,
	`first_seen_run_id` text,
	`last_seen_run_id` text,
	FOREIGN KEY (`flow_id`) REFERENCES `observed_flow`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `series_flow_idx` ON `series` (`flow_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `series_flow_key_uq` ON `series` (`flow_id`,`key_string`);--> statement-breakpoint
CREATE TABLE `series_attribute` (
	`series_id` integer NOT NULL,
	`attribute_id` text NOT NULL,
	`value` text,
	PRIMARY KEY(`series_id`, `attribute_id`),
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `series_key_value` (
	`series_id` integer NOT NULL,
	`dimension_id` text NOT NULL,
	`code_id` text NOT NULL,
	PRIMARY KEY(`series_id`, `dimension_id`),
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `series_key_value_lookup_idx` ON `series_key_value` (`dimension_id`,`code_id`);--> statement-breakpoint
CREATE TABLE `categorisation` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`scheme_id` text NOT NULL,
	`category_path` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `categorisation_flow_idx` ON `categorisation` (`flow_id`);--> statement-breakpoint
CREATE INDEX `categorisation_category_idx` ON `categorisation` (`scheme_id`,`category_path`);--> statement-breakpoint
CREATE TABLE `category` (
	`scheme_id` text NOT NULL,
	`category_path` text NOT NULL,
	`parent_path` text,
	`name` text,
	PRIMARY KEY(`scheme_id`, `category_path`),
	FOREIGN KEY (`scheme_id`) REFERENCES `category_scheme`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `category_scheme` (
	`id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`version` text NOT NULL,
	`name` text
);
--> statement-breakpoint
CREATE TABLE `code` (
	`codelist_id` text NOT NULL,
	`code_id` text NOT NULL,
	`name` text,
	`description` text,
	`parent_code_id` text,
	`sort_order` integer,
	PRIMARY KEY(`codelist_id`, `code_id`),
	FOREIGN KEY (`codelist_id`) REFERENCES `codelist`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `code_parent_idx` ON `code` (`codelist_id`,`parent_code_id`);--> statement-breakpoint
CREATE TABLE `code_annotation` (
	`codelist_id` text NOT NULL,
	`code_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text,
	`text` text
);
--> statement-breakpoint
CREATE INDEX `code_annotation_code_idx` ON `code_annotation` (`codelist_id`,`code_id`);--> statement-breakpoint
CREATE INDEX `code_annotation_type_idx` ON `code_annotation` (`type`);--> statement-breakpoint
CREATE TABLE `code_closure` (
	`codelist_id` text NOT NULL,
	`ancestor_code_id` text NOT NULL,
	`descendant_code_id` text NOT NULL,
	`depth` integer NOT NULL,
	PRIMARY KEY(`codelist_id`, `ancestor_code_id`, `descendant_code_id`)
);
--> statement-breakpoint
CREATE INDEX `code_closure_descendant_idx` ON `code_closure` (`codelist_id`,`descendant_code_id`);--> statement-breakpoint
CREATE TABLE `codelist` (
	`id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`version` text NOT NULL,
	`name` text,
	`description` text,
	`code_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `concept` (
	`scheme_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`name` text,
	`description` text,
	PRIMARY KEY(`scheme_id`, `concept_id`),
	FOREIGN KEY (`scheme_id`) REFERENCES `concept_scheme`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `concept_scheme` (
	`id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`version` text NOT NULL,
	`name` text
);
