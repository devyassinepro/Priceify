// app/shopify.server.ts - Avec auto-sync intégré

import "@shopify/shopify-app-remix/adapters/node";
import {
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
  LATEST_API_VERSION,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { restResources } from "@shopify/shopify-api/rest/admin/2023-10";
import { PrismaClient } from "@prisma/client";
import { getOrCreateSubscription } from "./models/subscription.server";

const prisma = new PrismaClient();

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: LATEST_API_VERSION,
  scopes: process.env.SHOPIFY_SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "https://localhost:3000",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  restResources,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/uninstalled",
    },
    CUSTOMERS_DATA_REQUEST: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/gdpr",
    },
    CUSTOMERS_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/gdpr",
    },
    SHOP_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/gdpr",
    },
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      try {
        console.log(`🔗 Processing afterAuth for ${session.shop}`);
        
        // 1. Enregistrer les webhooks
        shopify.registerWebhooks({ session });
        
        // 2. Créer l'abonnement local
        console.log(`📋 Creating subscription for ${session.shop}`);
        await getOrCreateSubscription(session.shop);
        
        // 3. ✅ AUTO-SYNC AUTOMATIQUE lors de l'installation/réinstallation
        console.log(`🔄 Running auto-sync for ${session.shop}`);
        
        try {
          const { autoSyncSubscription } = await import("./lib/auto-sync.server");
          const syncResult = await autoSyncSubscription(admin, session.shop);
          
          if (syncResult.success) {
            console.log(`✅ Auto-sync successful in afterAuth: ${syncResult.message}`);
          } else {
            console.log(`ℹ️ Auto-sync in afterAuth: ${syncResult.message || syncResult.error}`);
          }
        } catch (syncError) {
          console.error("❌ Auto-sync error in afterAuth:", syncError);
          // Ne pas faire échouer l'installation pour ça
        }
        
        console.log(`✅ afterAuth completed for ${session.shop}`);
        
      } catch (error) {
        console.error("❌ Error in afterAuth hook:", error);
        // Ne pas faire échouer l'installation
      }
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
});

export default shopify;
export const apiVersion = LATEST_API_VERSION;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;