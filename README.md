# Omen E-Commerce Platform

## Overview
A full-stack e-commerce platform built for the Omen apparel brand. The application supports product browsing, checkout, payment processing, and fulfillment workflows through third-party integrations.

## Tech Stack
- JavaScript
- React
- Node.js
- Express
- Stripe API
- Printful API
- REST APIs
- Webhooks

## Core Features

### Storefront
- Displays branded products for customers to browse and purchase
- Supports a full product-to-checkout shopping flow

### Payment Processing
- Integrates Stripe Checkout for secure payment handling
- Uses webhook-based logic to process post-payment events

### Fulfillment Automation
- Connects with Printful API to automate order fulfillment
- Supports hybrid fulfillment workflows for automated and manual order handling

### Backend Services
- Handles checkout session creation
- Processes customer order data
- Manages third-party API communication securely

## System Flow
1. Customer selects products
2. Application creates a Stripe checkout session
3. Stripe confirms successful payment
4. Webhook triggers order processing
5. Fulfillment workflow sends order data to external provider

## Use Case
Designed as a production-style e-commerce system for a direct-to-consumer apparel brand.

## Notes
This project demonstrates full-stack application development, payment integration, webhook handling, and third-party fulfillment automation.

## 🚀 Getting Started

1. Install dependencies:
npm install

2. Create a .env file using .env.example

3. Start the server:
npm run dev
