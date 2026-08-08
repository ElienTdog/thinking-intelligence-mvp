CREATE TABLE `daily_stories` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`story_date` text NOT NULL,
	`title` text NOT NULL,
	`opening_question` text NOT NULL,
	`takeaway` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_stories_owner_date` ON `daily_stories` (`owner_id`,`story_date`);--> statement-breakpoint
CREATE TABLE `feed_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`card_id` text NOT NULL,
	`event_type` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `knowledge_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_feed_events_owner_card` ON `feed_events` (`owner_id`,`card_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `injection_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`run_date` text NOT NULL,
	`status` text NOT NULL,
	`sources_scanned` integer DEFAULT 0 NOT NULL,
	`raw_created` integer DEFAULT 0 NOT NULL,
	`cards_created` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_injection_runs_owner_date` ON `injection_runs` (`owner_id`,`run_date`);--> statement-breakpoint
CREATE TABLE `knowledge_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`raw_source_id` text NOT NULL,
	`story_id` text,
	`story_position` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`hook` text NOT NULL,
	`explanation` text NOT NULL,
	`reasoning_move` text NOT NULL,
	`boundary` text NOT NULL,
	`why_it_matters` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source_name` text NOT NULL,
	`source_url` text NOT NULL,
	`verification_status` text DEFAULT 'verified' NOT NULL,
	`state` text DEFAULT 'published' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`raw_source_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`story_id`) REFERENCES `daily_stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cards_owner_created` ON `knowledge_cards` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_cards_owner_story` ON `knowledge_cards` (`owner_id`,`story_id`,`story_position`);--> statement-breakpoint
CREATE INDEX `idx_cards_owner_raw` ON `knowledge_cards` (`owner_id`,`raw_source_id`);--> statement-breakpoint
CREATE TABLE `source_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`feed_type` text NOT NULL,
	`topic` text DEFAULT 'AI 与产品' NOT NULL,
	`trust_level` integer DEFAULT 2 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_source_feeds_owner_enabled` ON `source_feeds` (`owner_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_source_feeds_owner_url` ON `source_feeds` (`owner_id`,`url`);--> statement-breakpoint
ALTER TABLE `clips` ADD `origin` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `source_type` text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `publisher` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `published_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `verification_status` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `processing_status` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `raw_excerpt` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `content_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `priority` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `processing_error` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `processed_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_clips_owner_processing` ON `clips` (`owner_id`,`processing_status`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_clips_owner_hash` ON `clips` (`owner_id`,`content_hash`);