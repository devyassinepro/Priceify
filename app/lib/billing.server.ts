// app/lib/billing.server.ts - Gestionnaire de billing centralisé

import { authenticate } from "../shopify.server";
import { updateSubscription, getOrCreateSubscription } from "../models/subscription.server";
import { PLANS, getPlan } from "./plans";

export interface BillingResult {
  success: boolean;
  confirmationUrl?: string;
  subscriptionId?: string;
  error?: string;
  requiresPayment?: boolean;
}

export interface SubscriptionData {
  id: string;
  name: string;
  status: string;
  currentPeriodEnd?: string;
  lineItems: Array<{
    plan: {
      pricingDetails: {
        price: {
          amount: string;
          currencyCode: string;
        };
        interval: string;
      };
    };
  }>;
}

/**
 * Créer ou mettre à jour un abonnement Shopify
 */
export async function createShopifySubscription(
  admin: any,
  shop: string,
  planName: string,
  options: {
    returnUrl?: string;
    test?: boolean;
    trialDays?: number;
  } = {}
): Promise<BillingResult> {
  try {
    const plan = getPlan(planName);
    
    if (!plan) {
      return { success: false, error: "Plan not found" };
    }

    if (plan.name === 'free') {
      // Pour le plan gratuit, pas besoin de billing Shopify
      await updateSubscription(shop, {
        planName: 'free',
        status: 'active',
        usageLimit: plan.usageLimit,
        subscriptionId: undefined,
      });
      
      return { success: true };
    }

    const returnUrl = options.returnUrl || 
      `${process.env.SHOPIFY_APP_URL}/app?billing_completed=1&sync_needed=1&plan=${planName}`;

    // Construire la mutation GraphQL
    const mutation = `
      mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $test: Boolean!, $lineItems: [AppSubscriptionLineItemInput!]!) {
        appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
          appSubscription {
            id
            name
            status
            currentPeriodEnd
          }
          confirmationUrl
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables: any = {
      name: `${plan.displayName} Plan`,
      returnUrl,
      test: options.test ?? (process.env.NODE_ENV !== "production"),
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { 
                amount: plan.price, 
                currencyCode: plan.currency 
              },
              interval: plan.billingInterval || "EVERY_30_DAYS"
            }
          }
        }
      ]
    };

    // Ajouter l'essai gratuit si spécifié
    if (options.trialDays && options.trialDays > 0) {
      variables.lineItems[0].plan.appRecurringPricingDetails.trialDays = options.trialDays;
    }

    console.log(`🔄 Creating subscription for ${shop}:`, {
      plan: plan.displayName,
      price: plan.price,
      trialDays: options.trialDays
    });

    const response = await admin.graphql(mutation, { variables });
    const result = await response.json();

    if (result.data?.appSubscriptionCreate?.userErrors?.length > 0) {
      const errors = result.data.appSubscriptionCreate.userErrors;
      console.error('Subscription creation errors:', errors);
      return {
        success: false,
        error: errors.map((e: any) => e.message).join(', ')
      };
    }

    const subscriptionData = result.data?.appSubscriptionCreate?.appSubscription;
    const confirmationUrl = result.data?.appSubscriptionCreate?.confirmationUrl;

    if (!confirmationUrl) {
      return {
        success: false,
        error: "No confirmation URL returned from Shopify"
      };
    }

    // Sauvegarder l'ID de l'abonnement pour référence future
    if (subscriptionData?.id) {
      await updateSubscription(shop, {
        subscriptionId: subscriptionData.id,
        planName: planName,
        status: 'pending', // En attente de confirmation
      });
    }

    console.log(`✅ Subscription created successfully`);
    console.log(`🔗 Confirmation URL: ${confirmationUrl}`);

    return {
      success: true,
      confirmationUrl,
      subscriptionId: subscriptionData?.id,
      requiresPayment: true
    };

  } catch (error: any) {
    console.error('Error creating subscription:', error);
    return {
      success: false,
      error: `Failed to create subscription: ${error.message}`
    };
  }
}

/**
 * Annuler un abonnement Shopify
 */
export async function cancelShopifySubscription(
  admin: any,
  shop: string,
  subscriptionId?: string
): Promise<BillingResult> {
  try {
    const localSubscription = await getOrCreateSubscription(shop);
    const targetSubscriptionId = subscriptionId || localSubscription.subscriptionId;

    if (!targetSubscriptionId) {
      // Pas d'abonnement à annuler, juste mettre à jour localement
      await updateSubscription(shop, {
        planName: 'free',
        status: 'active',
        usageLimit: PLANS.free.usageLimit,
        subscriptionId: undefined,
      });
      
      return { success: true };
    }

    const mutation = `
      mutation AppSubscriptionCancel($id: ID!) {
        appSubscriptionCancel(id: $id) {
          appSubscription {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response = await admin.graphql(mutation, {
      variables: { id: targetSubscriptionId }
    });

    const result = await response.json();

    if (result.data?.appSubscriptionCancel?.userErrors?.length > 0) {
      const errors = result.data.appSubscriptionCancel.userErrors;
      return {
        success: false,
        error: errors.map((e: any) => e.message).join(', ')
      };
    }

    // Mettre à jour l'abonnement local
    await updateSubscription(shop, {
      planName: 'free',
      status: 'active',
      usageLimit: PLANS.free.usageLimit,
      subscriptionId: undefined,
    });

    console.log(`✅ Subscription cancelled for ${shop}`);
    return { success: true };

  } catch (error: any) {
    console.error('Error cancelling subscription:', error);
    return {
      success: false,
      error: `Failed to cancel subscription: ${error.message}`
    };
  }
}

/**
 * Récupérer les abonnements actifs depuis Shopify
 */
export async function getActiveSubscriptions(admin: any): Promise<SubscriptionData[]> {
  try {
    const query = `
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
    `;

    const response = await admin.graphql(query);
    const result = await response.json();

    return result.data?.app?.installation?.activeSubscriptions || [];

  } catch (error: any) {
    console.error('Error fetching active subscriptions:', error);
    return [];
  }
}

/**
 * Synchroniser l'abonnement local avec Shopify
 */
export async function syncSubscriptionWithShopify(
  admin: any,
  shop: string
): Promise<{ success: boolean; syncedPlan?: string; error?: string }> {
  try {
    console.log(`🔄 Syncing subscription for ${shop}...`);

    const activeSubscriptions = await getActiveSubscriptions(admin);
    
    if (activeSubscriptions.length === 0) {
      // Aucun abonnement actif -> plan gratuit
      await updateSubscription(shop, {
        planName: 'free',
        status: 'active',
        usageLimit: PLANS.free.usageLimit,
        subscriptionId: undefined,
      });
      
      return { success: true, syncedPlan: 'free' };
    }

    // Prendre le premier abonnement actif
    const subscription = activeSubscriptions[0];
    const amount = parseFloat(subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0");
    
    // Mapper le montant au plan correspondant
    let detectedPlan = 'free';
    for (const [planKey, planData] of Object.entries(PLANS)) {
      if (Math.abs(planData.price - amount) < 0.02) {
        detectedPlan = planKey;
        break;
      }
    }

    // Mettre à jour l'abonnement local
    await updateSubscription(shop, {
      planName: detectedPlan,
      status: subscription.status.toLowerCase(),
      usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
      subscriptionId: subscription.id,
      currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : undefined,
    });

    console.log(`✅ Subscription synced to ${detectedPlan} plan`);
    return { success: true, syncedPlan: detectedPlan };

  } catch (error: any) {
    console.error('Error syncing subscription:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Vérifier si un utilisateur est éligible pour un essai gratuit
 */
export async function checkTrialEligibility(shop: string, planName: string): Promise<{
  eligible: boolean;
  trialDays: number;
  reason?: string;
}> {
  try {
    const subscription = await getOrCreateSubscription(shop);
    const plan = getPlan(planName);

    // Plan gratuit = pas d'essai
    if (plan.name === 'free') {
      return { eligible: false, trialDays: 0, reason: "Free plan doesn't require trial" };
    }

    // Pas d'essai défini pour ce plan
    if (!plan.trialDays) {
      return { eligible: false, trialDays: 0, reason: "No trial available for this plan" };
    }

    // Vérifier si l'utilisateur n'a jamais eu d'abonnement payant
    const hasHadPaidPlan = subscription.planName !== 'free' || 
                          subscription.subscriptionId !== null;

    if (hasHadPaidPlan) {
      return { 
        eligible: false, 
        trialDays: 0, 
        reason: "Already used paid features" 
      };
    }

    // Vérifier si l'utilisation est faible (nouveaux utilisateurs)
    const lowUsage = subscription.usageCount < 10;
    
    if (!lowUsage) {
      return { 
        eligible: false, 
        trialDays: 0, 
        reason: "High usage on free plan" 
      };
    }

    return { 
      eligible: true, 
      trialDays: plan.trialDays 
    };

  } catch (error: any) {
    console.error('Error checking trial eligibility:', error);
    return { 
      eligible: false, 
      trialDays: 0, 
      reason: "Error checking eligibility" 
    };
  }
}