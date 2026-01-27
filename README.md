# Discord SelfBot Message Scheduler (SaaS Edition)

## Project Overview

This project is an enterprise-grade automated message scheduling system designed for Discord Selfbots. It has been re-architected from a simple script into a robust SaaS (Software as a Service) platform capable of managing multiple user accounts, secure token storage, payment integration, and isolated task execution.

The system utilizes a modern technology stack including TypeScript for type safety, Prisma with MongoDB for data persistence, and Node.js Worker Threads for performance isolation.

## Technical Architecture

### Core Components

*   **Language**: TypeScript (Node.js)
*   **Database**: MongoDB (via Prisma ORM)
*   **Process Management**: Worker Threads (isolating bot instances from the main application logic)
*   **Security**: AES-256 encryption for sensitive token storage
*   **Interaction**: Discord Slash Commands, Buttons, and Modals

### Key Modules

*   **Service Layer (`src/services/`)**: Handles business logic, database transactions, and encryption.
*   **Worker Engine (`src/workers/`)**: Executes the actual selfbot operations (message sending, fetching guilds) in separate threads to prevent main process blocking.
*   **Interaction Handlers (`src/handlers/`)**: Manages user interactions through the Discord UI without direct database exposure.

## Prerequisites

Ensure the following dependencies are installed in your environment:

*   Node.js (v18 or higher recommended)
*   npm (Node Package Manager)
*   MongoDB Instance (Local or Cloud/Atlas)

## Installation Guide

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/Gioxaa/Discord-SelfBot-MessageScheduler.git
    cd Discord-SelfBot-MessageScheduler
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Environment Configuration**
    Create a `.env` file in the root directory based on the template below. Ensure all keys are populated correctly.

    ```env
    # Application Configuration
    PORT=3000
    
    # Database Connection (MongoDB)
    DATABASE_URL="mongodb+srv://<username>:<password>@cluster.mongodb.net/dbname"

    # Discord Bot Credentials (The Manager Bot)
    BOT_TOKEN="your_discord_bot_token"
    CLIENT_ID="your_discord_client_id"
    GUILD_ID="your_target_guild_id"

    # Security (MUST be exactly 32 characters)
    ENCRYPTION_KEY="12345678901234567890123456789012"

    # Payment Gateway (Pakasir)
    PAKASIR_API_KEY="your_pakasir_api_key"
    PAKASIR_PROJECT_SLUG="your_project_slug"
    WEBHOOK_URL="https://your-domain.com/api/webhook/payment"

    # Administration
    ADMIN_ID="your_discord_user_id"
    ADMIN_ROLE_ID="your_admin_role_id"
    ```

4.  **Database Synchronization**
    Push the Prisma schema to your MongoDB instance.
    ```bash
    npm run db:push
    ```

5.  **Build the Project**
    Compile the TypeScript source code into JavaScript.
    ```bash
    npm run build
    ```

## Usage Instructions

### Development Mode
To run the application with hot-reloading enabled (using Nodemon):
```bash
npm run dev
```

### Production Mode
To run the compiled application:
```bash
npm start
```

### Deploying Slash Commands
Whenever changes are made to the command definitions in `src/commands/`, execute the deployment script to update them on Discord:
```bash
npm run deploy
```

## Features

### Dynamic Delay Management
The system supports both manual delay configuration (fixed ranges) and automatic dynamic delay. In automatic mode, the scheduler intelligently adapts the message frequency based on the channel's slowmode settings to prevent rate-limiting.

### Secure Multi-Account Management
Users can add multiple Discord accounts. Tokens are encrypted using AES-256 before storage and are only decrypted temporarily within the isolated worker thread during task execution.

### Payment Integration
Built-in integration with Pakasir allows for automated subscription management. Users can purchase access plans directly through the Discord interface, with immediate activation upon payment confirmation via Webhook.

## Directory Structure

*   `src/api/`: Express server and Webhook controllers.
*   `src/commands/`: Definitions for Discord Slash Commands.
*   `src/database/`: Prisma client configuration.
*   `src/handlers/`: Logic for handling Button and Modal interactions.
*   `src/services/`: Core business logic and database abstractions.
*   `src/utils/`: Helper functions for encryption, logging, and validation.
*   `src/views/`: UI component generators (Embeds, Rows).
*   `src/workers/`: Independent scripts for running selfbot tasks.

## License

This project is licensed under the MIT License.
