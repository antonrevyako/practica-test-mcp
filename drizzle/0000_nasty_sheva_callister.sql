CREATE TABLE `answers` (
	`run_id` text NOT NULL,
	`question_id` text NOT NULL,
	`option_ids` text NOT NULL,
	`correct` integer NOT NULL,
	`answered_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `question_id`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`submitted_at` text,
	`sync_state` text DEFAULT 'local' NOT NULL
);
