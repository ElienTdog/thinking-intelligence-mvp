CREATE TABLE `clips` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`content` text NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`source_title` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'captured' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_clips_owner_created` ON `clips` (`owner_id`,`created_at`);