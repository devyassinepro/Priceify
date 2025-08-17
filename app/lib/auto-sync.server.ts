import { updateSubscription, getOrCreateSubscription } from "../models/subscription.server";
import { PLANS } from "./plans";

export interface SyncResult {
  success: boolean;
  syncedPlan?: string;
  message?: string;
  error?: string;
  source?: 'AppSubscription' | 'AppRecurringApplicationCharge' | 'none';
}

/**
 * Synchronise automatiquement l'abonnement avec Shopify
 */
export async function autoSyncSubscription(admin: any, shop: string): Promise<SyncResult> {
  try {
    console.log(`🔄 Auto-syncing subscription for ${shop}...`);

    // 1. Vérifier d'abord les AppSubscriptions
    const subscriptionResult = await syncFromAppSubscriptions(admin, shop);
    if (subscriptionResult.success) {
      return subscriptionResult;
    }

    // 2. Si pas trouvé, essayer les AppRecurringApplicationCharges
    const chargeResult = await syncFromAppCharges(admin, shop);
    if (chargeResult.success) {
      return chargeResult;
    }

    // 3. Aucun abonnement actif trouvé - rester sur free
    console.log(`ℹ️ No active billing found for ${shop} - keeping free plan`);
    
    await updateSubscription(shop, {
      planName: "free",
      status: "active",
      usageLimit: PLANS.free.usageLimit,
      subscriptionId: undefined,
    });

    return {
      success: true,
      syncedPlan: "free",
      message: "No active subscription found - confirmed free plan",
      source: 'none'
    };

  } catch (error: any) {
    console.error(`❌ Auto-sync failed for ${shop}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Synchronise depuis les AppSubscriptions
 */
async function syncFromAppSubscriptions(admin: any, shop: string): Promise<SyncResult> {
  try {
    const response = await admin.graphql(`
      query GetActiveSubscriptions {
        app {
          installation {
            activeSubscriptions {
              id
              name
              status
              currentPeriodEnd
              lineItems {
                plan {
                  pricingDetails {
                    ... on AppRecurringPricing {
                      price {
                        amount
                        currencyCode
                      }
                      interval
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);

    const data = await response.json();
    const activeSubscriptions = data.data?.app?.installation?.activeSubscriptions || [];

    if (activeSubscriptions.length === 0) {
      return { success: false, message: "No AppSubscriptions found" };
    }

    const subscription = activeSubscriptions[0];
    
    if (subscription.status !== "ACTIVE") {
      return { success: false, message: `AppSubscription status: ${subscription.status}` };
    }

    const amount = parseFloat(subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0");
    console.log(`💰 Found AppSubscription with amount: $${amount}`);

    // Mapper au plan
    const detectedPlan = mapAmountToPlan(amount);
    
    if (detectedPlan === "free" && amount > 0) {
      return { success: false, message: `Unknown amount: $${amount}` };
    }

    // Mettre à jour l'abonnement local
    await updateSubscription(shop, {
      planName: detectedPlan,
      status: "active",
      usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
      subscriptionId: subscription.id,
      currentPeriodEnd: subscription.currentPeriodEnd 
        ? new Date(subscription.currentPeriodEnd) 
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    console.log(`✅ Synced from AppSubscription to ${detectedPlan} plan`);

    return {
      success: true,
      syncedPlan: detectedPlan,
      message: `Synced from AppSubscription: ${PLANS[detectedPlan as keyof typeof PLANS].displayName} ($${amount})`,
      source: 'AppSubscription'
    };

  } catch (error: any) {
    console.log(`ℹ️ AppSubscription sync failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Synchronise depuis les AppRecurringApplicationCharges
 */
async function syncFromAppCharges(admin: any, shop: string): Promise<SyncResult> {
  try {
    const response = await admin.graphql(`
      query GetAppRecurringApplicationCharges($first: Int!) {
        appRecurringApplicationCharges(first: $first) {
          edges {
            node {
              id
              name
              price {
                amount
                currencyCode
              }
              status
              createdAt
              activatedOn
            }
          }
        }
      }
    `, {
      variables: { first: 10 }
    });

    const data = await response.json();
    const charges = data.data?.appRecurringApplicationCharges?.edges?.map((edge: any) => edge.node) || [];
    const activeCharges = charges.filter((charge: any) => charge.status === "active");

    if (activeCharges.length === 0) {
      return { success: false, message: "No active AppRecurringApplicationCharges found" };
    }

    const charge = activeCharges[0]; // Prendre la plus récente
    const amount = parseFloat(charge.price?.amount || "0");
    console.log(`💰 Found AppRecurringApplicationCharge with amount: $${amount}`);

    // Mapper au plan
    const detectedPlan = mapAmountToPlan(amount);
    
    if (detectedPlan === "free" && amount > 0) {
      return { success: false, message: `Unknown amount: $${amount}` };
    }

    // Mettre à jour l'abonnement local
    await updateSubscription(shop, {
      planName: detectedPlan,
      status: "active",
      usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
      subscriptionId: charge.id,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    console.log(`✅ Synced from AppRecurringApplicationCharge to ${detectedPlan} plan`);

    return {
      success: true,
      syncedPlan: detectedPlan,
      message: `Synced from AppRecurringApplicationCharge: ${PLANS[detectedPlan as keyof typeof PLANS].displayName} ($${amount})`,
      source: 'AppRecurringApplicationCharge'
    };

  } catch (error: any) {
    console.log(`ℹ️ AppRecurringApplicationCharge sync failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Mappe un montant à un plan
 */
function mapAmountToPlan(amount: number): string {
  for (const [planKey, planData] of Object.entries(PLANS)) {
    if (Math.abs(planData.price - amount) < 0.02) { // Tolérance de 2 centimes
      return planKey;
    }
  }
  return "free";
}

/**
 * Vérifie si un abonnement local est probablement obsolète
 */
export async function needsSync(shop: string): Promise<boolean> {
  try {
    const subscription = await getOrCreateSubscription(shop);
    
    // Si c'est gratuit et récemment créé, pas besoin de sync
    if (subscription.planName === "free") {
      const hoursSinceCreation = (Date.now() - new Date(subscription.createdAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceCreation < 1) { // Moins d'1 heure
        return false;
      }
    }
    
    // Si pas de subscriptionId mais plan payant, probablement obsolète
    if (subscription.planName !== "free" && !subscription.subscriptionId) {
      return true;
    }
    
    // Si mis à jour il y a plus de 24h, vérifier
    const hoursSinceUpdate = (Date.now() - new Date(subscription.updatedAt).getTime()) / (1000 * 60 * 60);
    return hoursSinceUpdate > 24;
    
  } catch (error) {
    console.error("Error checking sync needs:", error);
    return false;
  }
}

/**
 * Auto-sync intelligent qui ne fait rien si pas nécessaire
 */
export async function smartAutoSync(admin: any, shop: string): Promise<SyncResult | null> {
  const shouldSync = await needsSync(shop);
  
  if (!shouldSync) {
    console.log(`ℹ️ No sync needed for ${shop}`);
    return null;
  }
  
  console.log(`🔄 Smart sync triggered for ${shop}`);
  return await autoSyncSubscription(admin, shop);
}