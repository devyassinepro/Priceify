import { json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { useLoaderData, Link, useSearchParams } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import {
  Card,
  Layout,
  Page,
  Text,
  Button,
  ButtonGroup,
  Banner,
  Grid,
  ProgressBar,
  Icon,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import {
  PriceListIcon,
  ChartVerticalIcon,
  CheckCircleIcon,
  PlanIcon,
} from "@shopify/polaris-icons";
import { getSubscriptionStats, updateSubscription } from "../models/subscription.server";
import { getPlan, formatPriceDisplay, PLANS } from "../lib/plans";
import { smartAutoSync } from "../lib/auto-sync.server";
import { useEffect, useState } from "react";

// Interface pour les données de billing
interface BillingReturnData {
  billing_completed: string;
  charge_id: string;
  needs_manual_sync: string;
  shop: string;
  timestamp: number;
}

// Hook personnalisé pour gérer les données de billing
function useBillingReturnData() {
  const [billingData, setBillingData] = useState<BillingReturnData | null>(null);
  const [isProcessed, setIsProcessed] = useState(false);

  useEffect(() => {
    // Vérifier s'il y a des données de billing dans sessionStorage
    const storedData = sessionStorage.getItem('billing_return_data');
    
    if (storedData && !isProcessed) {
      try {
        const data = JSON.parse(storedData) as BillingReturnData;
        
        // Vérifier que les données ne sont pas trop anciennes (max 5 minutes)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        
        if (data.timestamp > fiveMinutesAgo) {
          console.log('🔄 Found billing return data in sessionStorage:', data);
          setBillingData(data);
          
          // Nettoyer le sessionStorage pour éviter de retraiter
          sessionStorage.removeItem('billing_return_data');
          
          // Marquer comme traité
          setIsProcessed(true);
          
          // Déclencher le traitement du billing côté serveur
          fetch('/api/process-billing-return', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
          }).then(response => {
            if (response.ok) {
              console.log('✅ Billing processed successfully');
              // Recharger la page pour voir les changements
              setTimeout(() => {
                window.location.reload();
              }, 1000);
            } else {
              console.error('❌ Error processing billing');
            }
          }).catch(error => {
            console.error('❌ Network error:', error);
          });
        } else {
          console.log('⏰ Billing data too old, ignoring');
          sessionStorage.removeItem('billing_return_data');
        }
      } catch (error) {
        console.error('❌ Error parsing billing data:', error);
        sessionStorage.removeItem('billing_return_data');
      }
    }
  }, [isProcessed]);

  return { billingData, isProcessed };
}

// Composant à ajouter dans votre JSX
function BillingReturnHandler() {
  const { billingData, isProcessed } = useBillingReturnData();

  if (billingData && !isProcessed) {
    return (
      <Layout.Section>
        <Banner title="🎉 Processing Your Payment..." tone="info">
          <Text as="p">
            Your payment has been completed successfully! We're updating your subscription now...
          </Text>
        </Banner>
      </Layout.Section>
    );
  }

  return null;
}


export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  const url = new URL(request.url);
  console.log(`🏠 App index loaded for ${session.shop}`);
  console.log(`🔗 Full URL: ${url.toString()}`);

  // ✅ SOLUTION: Détecter les paramètres de billing et forcer la synchronisation
  const billingCompleted = url.searchParams.get("billing_completed");
  const chargeId = url.searchParams.get("charge_id");
  const needsManualSync = url.searchParams.get("needs_manual_sync");
  const triggerSync = url.searchParams.get("trigger_sync");
  const syncNeeded = url.searchParams.get("sync_needed");
  const plan = url.searchParams.get("plan");
  
  console.log(`📋 Billing params detected:`);
  console.log(`- billing_completed: ${billingCompleted}`);
  console.log(`- charge_id: ${chargeId}`);
  console.log(`- needs_manual_sync: ${needsManualSync}`);
  console.log(`- trigger_sync: ${triggerSync}`);
  console.log(`- sync_needed: ${syncNeeded}`);
  console.log(`- plan: ${plan}`);

  let autoSyncResult = null;
  let billingMessage = null;
  let billingStatus = null;

  // ✅ SOLUTION: Forcer la synchronisation si le billing a été complété ou si manual sync requis
  const shouldForceSync = 
    triggerSync === "1" || 
    billingCompleted === "1" ||
    needsManualSync === "1" ||
    (billingCompleted === "1" && syncNeeded === "1");

  if (shouldForceSync) {
    console.log(`🔄 FORCED sync triggered - billing completed, manual sync needed, or explicit trigger`);
    
    // ✅ SOLUTION: Si on a un charge_id, essayer de traiter le billing manuellement
    if (chargeId && billingCompleted === "1") {
      console.log(`💳 Processing billing completion for charge: ${chargeId}`);
      
      try {
        // Essayer de récupérer et traiter l'abonnement directement
        let charge = null;
        let detectedPlan = "free";
        let isSubscription = false;

        // Essayer AppSubscription
        try {
          const subscriptionResponse = await admin.graphql(`
            query getAppSubscription($id: ID!) {
              appSubscription(id: $id) {
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
                      }
                    }
                  }
                }
              }
            }
          `, {
            variables: { id: `gid://shopify/AppSubscription/${chargeId}` }
          });

          const subscriptionResult = await subscriptionResponse.json();
          charge = subscriptionResult.data?.appSubscription;
          
          if (charge && charge.status === "ACTIVE") {
            console.log(`📊 Found active AppSubscription`);
            isSubscription = true;
            
            const amount = parseFloat(charge.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0");
            console.log(`💰 Amount: ${amount}`);
            
            // Mapper au plan correspondant
            for (const [planKey, planData] of Object.entries(PLANS)) {
              if (Math.abs(planData.price - amount) < 0.02) {
                detectedPlan = planKey;
                break;
              }
            }
          }
        } catch (error) {
          console.log(`ℹ️ Not an AppSubscription, trying AppRecurringApplicationCharge...`);
        }

        // Si pas trouvé, essayer AppRecurringApplicationCharge
        if (!charge) {
          try {
            const chargeResponse = await admin.graphql(`
              query getAppRecurringApplicationCharge($id: ID!) {
                appRecurringApplicationCharge(id: $id) {
                  id
                  name
                  price {
                    amount
                    currencyCode
                  }
                  status
                }
              }
            `, {
              variables: { id: `gid://shopify/AppRecurringApplicationCharge/${chargeId}` }
            });

            const chargeResult = await chargeResponse.json();
            charge = chargeResult.data?.appRecurringApplicationCharge;
            
            if (charge && charge.status === "active") {
              console.log(`📊 Found active AppRecurringApplicationCharge`);
              isSubscription = false;
              
              const amount = parseFloat(charge.price?.amount || "0");
              console.log(`💰 Amount: ${amount}`);
              
              // Mapper au plan correspondant
              for (const [planKey, planData] of Object.entries(PLANS)) {
                if (Math.abs(planData.price - amount) < 0.02) {
                  detectedPlan = planKey;
                  break;
                }
              }
            }
          } catch (error) {
            console.log(`❌ Error fetching charge:`, error);
          }
        }

        // Si on a trouvé un abonnement actif, mettre à jour localement
        if (charge && detectedPlan !== "free") {
          console.log(`✅ Updating subscription to ${detectedPlan} plan`);
          
          await updateSubscription(session.shop, {
            planName: detectedPlan,
            status: "active",
            usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
            subscriptionId: isSubscription ? `gid://shopify/AppSubscription/${chargeId}` : `gid://shopify/AppRecurringApplicationCharge/${chargeId}`,
            currentPeriodEnd: isSubscription && charge.currentPeriodEnd 
              ? new Date(charge.currentPeriodEnd) 
              : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          });

          billingStatus = "success";
          billingMessage = `🎉 Payment successful! You're now on the ${PLANS[detectedPlan as keyof typeof PLANS].displayName} plan.`;
          
          autoSyncResult = {
            success: true,
            syncedPlan: detectedPlan,
            message: `Manual billing sync successful: ${detectedPlan} plan activated`
          };
        } else {
          console.log(`⚠️ Could not process billing - charge not found or not active`);
          billingStatus = "error";
          billingMessage = "⚠️ Payment processed but plan activation failed. Please contact support.";
        }
        
      } catch (error) {
        console.error("❌ Error processing manual billing:", error);
        billingStatus = "error";
        billingMessage = "⚠️ Error processing your payment. Please try syncing manually or contact support.";
      }
    } else {
      // Sync normal sans billing
      try {
        const { autoSyncSubscription } = await import("../lib/auto-sync.server");
        autoSyncResult = await autoSyncSubscription(admin, session.shop);
        
        if (autoSyncResult?.success) {
          console.log(`✅ FORCED sync successful: ${autoSyncResult.message}`);
          billingStatus = "success";
          billingMessage = `✅ Subscription synced: You're on the ${autoSyncResult.syncedPlan} plan.`;
        } else {
          console.log(`❌ FORCED sync failed: ${autoSyncResult?.error}`);
        }
      } catch (error) {
        console.error("❌ FORCED sync error:", error);
      }
    }
  } else {
    // ✅ Auto-sync normal (intelligent)
    try {
      autoSyncResult = await smartAutoSync(admin, session.shop);
      
      if (autoSyncResult?.success) {
        console.log(`✅ Smart auto-sync successful: ${autoSyncResult.message}`);
      } else if (autoSyncResult) {
        console.log(`ℹ️ Smart auto-sync: ${autoSyncResult.message || autoSyncResult.error}`);
      }
    } catch (error) {
      console.error("❌ Smart auto-sync error:", error);
    }
  }

  // ✅ Gérer les erreurs de billing
  const billingError = url.searchParams.get("billing_error");
  
  if (billingError && !billingStatus) {
    billingStatus = "error";
    switch (billingError) {
      case "declined":
        billingMessage = "💳 Payment was declined. You can try again or choose a different payment method.";
        break;
      case "processing_error":
        billingMessage = "⚠️ There was an error processing your payment. Please try again.";
        break;
      case "charge_not_found":
        billingMessage = "❌ Payment information not found. Please try again.";
        break;
      case "missing_params":
        billingMessage = "❌ Invalid payment information. Please try again.";
        break;
      case "pending":
        billingMessage = "⏳ Your payment is being processed. Please wait a moment and refresh the page.";
        break;
      default:
        billingMessage = "⚠️ There was an issue with your payment. Please try again.";
    }
  }
  
  // Récupérer les données d'abonnement (après sync/update)
  const subscriptionStats = await getSubscriptionStats(session.shop);
  const planData = getPlan(subscriptionStats.planName);

  // Paramètres de synchronisation existants (garder pour compatibilité)
  const syncStatus = url.searchParams.get("sync");
  const syncPlan = url.searchParams.get("sync_plan");
  const syncMessage = url.searchParams.get("message");
  
  return json({
    shop: session.shop,
    subscription: subscriptionStats,
    plan: planData,
    usagePercentage: (subscriptionStats.usageCount / subscriptionStats.usageLimit) * 100,
    remainingProducts: subscriptionStats.usageLimit - subscriptionStats.usageCount,
    uniqueProductCount: subscriptionStats.uniqueProductCount || 0,
    billingStatus,
    billingMessage,
    syncStatus,
    syncPlan,
    syncMessage,
    autoSyncResult,
  });
};

export default function Index() {
  const { 
    shop, 
    subscription, 
    plan, 
    usagePercentage, 
    remainingProducts, 
    uniqueProductCount,
    billingStatus,
    billingMessage,
    syncStatus,
    syncPlan,
    syncMessage,
    autoSyncResult,
  } = useLoaderData<typeof loader>();
  
  const [searchParams, setSearchParams] = useSearchParams();

  const isNewUser = subscription.usageCount === 0;
  const isNearLimit = usagePercentage > 80;
  const hasReachedLimit = usagePercentage >= 100;

  // Nettoyer les paramètres après affichage
  useEffect(() => {
    if (billingStatus || syncStatus || autoSyncResult) {
      const timer = setTimeout(() => {
        const params = new URLSearchParams(searchParams);
        // Nettoyer les paramètres de billing
        params.delete("billing_completed");
        params.delete("billing_error");
        params.delete("plan");
        params.delete("charge_id");
        params.delete("needs_manual_sync");
        // Nettoyer les paramètres de sync
        params.delete("sync");
        params.delete("sync_plan");
        params.delete("message");
        params.delete("sync_needed");
        params.delete("trigger_sync");
        // Nettoyer les paramètres embedded
        params.delete("host");
        params.delete("shop");
        params.delete("hmac");
        params.delete("embedded");
        params.delete("id_token");
        params.delete("locale");
        params.delete("session");
        params.delete("timestamp");
        setSearchParams(params, { replace: true });
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [billingStatus, syncStatus, autoSyncResult, searchParams, setSearchParams]);

  return (
    <Page title="Dashboard" subtitle={`Dynamic Pricing for ${shop}`}>
      <Layout>
        {/* Auto-sync result banner */}
        {autoSyncResult?.success && !billingStatus && (
          <Layout.Section>
            <Banner title="🔄 Subscription Auto-Synced!" tone="success">
              <Text as="p">{autoSyncResult.message}</Text>
            </Banner>
          </Layout.Section>
        )}
        <BillingReturnHandler />

        {/* Bannières de billing */}
        {billingStatus === "success" && billingMessage && (
          <Layout.Section>
            <Banner title="🎉 Payment Successful!" tone="success">
              <Text as="p">{billingMessage}</Text>
              {autoSyncResult?.success && (
                <Text as="p" variant="bodySm" tone="subdued">
                  ✅ Your subscription has been automatically synchronized.
                </Text>
              )}
            </Banner>
          </Layout.Section>
        )}
        
        {billingStatus === "error" && billingMessage && (
          <Layout.Section>
            <Banner title="⚠️ Payment Issue" tone="critical">
              <Text as="p">{billingMessage}</Text>
              <div style={{ marginTop: "1rem" }}>
                <Link to="/app/billing">
                  <Button variant="primary">Try Again</Button>
                </Link>
                <span style={{ marginLeft: "1rem" }}>
                  <Link to="/app/manual-sync">
                    <Button>Manual Sync</Button>
                  </Link>
                </span>
              </div>
            </Banner>
          </Layout.Section>
        )}

        {/* Bannières de synchronisation */}
        {syncStatus === "success" && (
          <Layout.Section>
            <Banner title="🎉 Subscription Updated!" tone="success">
              <Text as="p">
                Your subscription has been successfully updated to the {syncPlan} plan. 
                You can now modify up to {plan.usageLimit === 99999 ? 'unlimited' : plan.usageLimit} products per month.
              </Text>
            </Banner>
          </Layout.Section>
        )}
        
        {syncStatus === "no_subscription" && (
          <Layout.Section>
            <Banner title="ℹ️ No Active Subscription" tone="info">
              <Text as="p">
                You're currently on the free plan. Visit our pricing page to upgrade and unlock more features.
              </Text>
            </Banner>
          </Layout.Section>
        )}
        
        {syncStatus === "error" && (
          <Layout.Section>
            <Banner title="⚠️ Sync Error" tone="warning">
              <Text as="p">
                There was an issue synchronizing your subscription: {syncMessage}. 
                Please try refreshing the page or contact support if the issue persists.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Avertissements d'utilisation */}
        {isNearLimit && !billingStatus && !syncStatus && (
          <Layout.Section>
            <Banner 
              title={hasReachedLimit ? "Product Limit Reached" : "Approaching Product Limit"}
              tone={hasReachedLimit ? "critical" : "warning"}
              action={hasReachedLimit ? {
                content: "View Pricing Plans",
                url: "/app/billing"
              } : {
                content: "View Pricing Plans",
                url: "/app/billing"
              }}
            >
              <Text as="p">
                You've modified {subscription.usageCount} of {subscription.usageLimit} allowed unique products this month
                {hasReachedLimit ? ". Upgrade to continue making changes." : "."}
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Statistiques rapides */}
        <Layout.Section>
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <Icon source={PlanIcon} />
                  </div>
                  <Text as="h3" variant="headingMd">Current Plan</Text>
                  <Text as="p" variant="bodyLg" tone={plan.name === "free" ? "subdued" : "success"}>
                    {plan.displayName}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {formatPriceDisplay(plan.price)}
                  </Text>
                </div>
              </Card>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <Icon source={ChartVerticalIcon} />
                  </div>
                  <Text as="h3" variant="headingMd">Products Modified</Text>
                  <Text as="p" variant="bodyLg">
                    {subscription.usageCount} / {subscription.usageLimit}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Unique products this month
                  </Text>
                  <div style={{ marginTop: "0.5rem" }}>
                    <ProgressBar 
                      progress={usagePercentage} 
                      size="small"
                      tone={hasReachedLimit ? "critical" : "primary"}
                    />
                  </div>
                </div>
              </Card>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <Icon source={CheckCircleIcon} />
                  </div>
                  <Text as="h3" variant="headingMd">Products Remaining</Text>
                  <Text as="p" variant="bodyLg" tone={remainingProducts > 0 ? "success" : "critical"}>
                    {remainingProducts}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    until {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}
                  </Text>
                </div>
              </Card>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <Icon source={PriceListIcon} />
                  </div>
                  <Text as="h3" variant="headingMd">Total Price Changes</Text>
                  <Text as="p" variant="bodyLg">
                    {subscription.totalPriceChanges || 0}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Individual changes made
                  </Text>
                </div>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* Actions principales */}
        <Layout.Section>
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 8, xl: 8 }}>
              <Card>
                <div style={{ padding: "2rem" }}>
                  <BlockStack gap="400">
                    <div>
                      <Text as="h2" variant="headingLg">Ready to optimize your pricing?</Text>
                      <Text as="p" tone="subdued">
                        Use our intelligent pricing tools to boost your revenue. Modify as many prices as you want per product!
                      </Text>
                    </div>
                    
                    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                      <Link to="/app/pricing">
                        <Button variant="primary" size="large" disabled={hasReachedLimit}>
                          {hasReachedLimit ? "Upgrade to Continue" : "Update Prices"}
                        </Button>
                      </Link>
                      
                      <Link to="/app/history">
                        <Button size="large">View History</Button>
                      </Link>

                      {plan.name === "free" && (
                        <Link to="/app/billing">
                          <Button size="large" tone="success">
                            🚀 View Pricing Plans
                          </Button>
                        </Link>
                      )}
                    
                      {/* Bouton de synchronisation manuelle */}
                      <Link to="/app/sync-subscription">
                        <Button size="large">
                          🔄 Sync Subscription
                        </Button>
                      </Link>
                    </div>
                  </BlockStack>
                </div>
              </Card>
            </Grid.Cell>
            
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
              <Card>
                <div style={{ padding: "1.5rem" }}>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">How it works</Text>
                    
                    <div>
                      <Text as="p" variant="bodySm">
                        <strong>1. Select</strong> products to modify (counts toward quota)
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>2. Choose</strong> adjustment type (%, fixed price, etc.)
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>3. Preview</strong> changes before applying
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>4. Apply</strong> updates (modify variants freely within each product)
                      </Text>
                      {plan.name === "free" && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          <strong>5. Upgrade</strong> to modify more products per month
                        </Text>
                      )}
                    </div>
                  </BlockStack>
                </div>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* Message de bienvenue pour nouveaux utilisateurs */}
        {isNewUser && !billingStatus && !syncStatus && (
          <Layout.Section>
            <Card>
              <div style={{ 
                padding: "2rem", 
                textAlign: "center",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                color: "white",
                borderRadius: "8px"
              }}>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingLg" tone="inherit">
                    🎉 Welcome to PriceBoost!
                  </Text>
                  <Text as="p" tone="inherit">
                    You're all set up with the free plan. Start by modifying some product prices to see how it works.
                  </Text>
                  <div>
                    <Link to="/app/pricing">
                      <Button size="large" tone="success">
                        🚀 Start Modifying Prices
                      </Button>
                    </Link>
                  </div>
                  <Text as="p" variant="bodySm" tone="inherit">
                    ✨ You can modify up to {subscription.usageLimit} unique products per month on the free plan.
                  </Text>
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>
        )}

        {/* CTA d'upgrade pour plan gratuit */}
        {plan.name === "free" && !hasReachedLimit && !isNewUser && !billingStatus && !syncStatus && (
          <Layout.Section>
            <Card>
              <div style={{ 
                padding: "2rem", 
                textAlign: "center",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                color: "white",
                borderRadius: "8px"
              }}>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingLg" tone="inherit">
                    Ready to modify more products?
                  </Text>
                  <Text as="p" tone="inherit">
                    Upgrade to Standard (500 products) or Pro (unlimited products) to unlock your pricing potential.
                  </Text>
                  <div>
                    <Link to="/app/billing">
                      <Button size="large" tone="success">
                        🚀 View Pricing Plans
                      </Button>
                    </Link>
                  </div>
                  <Text as="p" variant="bodySm" tone="inherit">
                    ✨ After upgrading, return here and your new plan will be automatically activated!
                  </Text>
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>
        )}

        {/* Informations sur l'utilisation avancée */}
        {!isNewUser && subscription.usageCount > 5 && (
          <Layout.Section>
            <Card>
              <div style={{ padding: "1.5rem" }}>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">📊 Your Usage Insights</Text>
                  
                  <div style={{ 
                    display: "grid", 
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", 
                    gap: "1rem" 
                  }}>
                    <div>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {((subscription.usageCount / subscription.usageLimit) * 100).toFixed(1)}%
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        of monthly quota used
                      </Text>
                    </div>
                    
                    <div>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {subscription.totalPriceChanges ? Math.round(subscription.totalPriceChanges / subscription.usageCount) : 0}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        avg. changes per product
                      </Text>
                    </div>
                    
                    <div>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {plan.displayName}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        current plan
                      </Text>
                    </div>
                  </div>
                  
                  {plan.name === "free" && subscription.usageCount > 15 && (
                    <div style={{ 
                      padding: "1rem", 
                      backgroundColor: "#f6f6f7", 
                      borderRadius: "8px",
                      border: "1px solid #e1e3e5"
                    }}>
                      <Text as="p" variant="bodySm">
                        💡 <strong>Pro Tip:</strong> You're using your free plan efficiently! 
                        Consider upgrading to unlock more products and advanced features.
                      </Text>
                    </div>
                  )}
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}