ALTER TABLE `knowledge_cards` ADD `topic_features` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `knowledge_cards` ADD `unit_key` text DEFAULT 'source' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_cards_owner_raw_unit` ON `knowledge_cards` (`owner_id`,`raw_source_id`,`unit_key`);
--> statement-breakpoint
CREATE TABLE `recommendation_models` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`policy_version` text NOT NULL,
	`model_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_recommendation_models_updated` ON `recommendation_models` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `feed_impressions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`session_id` text NOT NULL,
	`card_id` text NOT NULL,
	`topic` text NOT NULL,
	`position` integer NOT NULL,
	`policy` text NOT NULL,
	`selection_probability` text NOT NULL,
	`was_shown` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `knowledge_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_feed_impressions_owner_session` ON `feed_impressions` (`owner_id`,`session_id`,`policy`);
--> statement-breakpoint
CREATE INDEX `idx_feed_impressions_owner_card` ON `feed_impressions` (`owner_id`,`card_id`,`was_shown`,`created_at`);
