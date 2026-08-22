CREATE TABLE `conversationMessages` (
	`id` varchar(36) NOT NULL,
	`conversationId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`replyToMessageId` varchar(36),
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`providerId` varchar(64),
	`modelId` varchar(255),
	`status` enum('completed','failed') NOT NULL DEFAULT 'completed',
	`errorMessage` text,
	`latencyMs` int,
	`promptTokens` int,
	`completionTokens` int,
	`totalTokens` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversationMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`systemPrompt` text,
	`mode` enum('solo','competition') NOT NULL DEFAULT 'solo',
	`selectedModels` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `providerConfigurations` MODIFY COLUMN `credentialSource` enum('platform','environment','encrypted_user_key') NOT NULL;--> statement-breakpoint
ALTER TABLE `providerConfigurations` ADD `credentialEncrypted` text;--> statement-breakpoint
ALTER TABLE `conversationMessages` ADD CONSTRAINT `conversationMessages_conversationId_conversations_id_fk` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversationMessages` ADD CONSTRAINT `conversationMessages_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `conversation_messages_conversation_created_idx` ON `conversationMessages` (`conversationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `conversation_messages_user_created_idx` ON `conversationMessages` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `conversations_user_updated_idx` ON `conversations` (`userId`,`updatedAt`);