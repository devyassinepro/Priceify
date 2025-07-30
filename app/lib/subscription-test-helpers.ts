
import { updateSubscription, resetUsage } from "../models/subscription.server";
import { PLANS } from "./plans";
import { db } from "../db.server";

export interface TestSubscriptionOptions {
  planName: keyof typeof PLANS;
  usageCount?: number;
  resetUsage?: boolean;
  simulateNearLimit?: boolean;
  simulateOverLimit?: boolean;
}

/**
 * Set up subscription for testing scenarios
 */
export async function setupTestSubscription(
  shop: string, 
  options: TestSubscriptionOptions
) {
  const plan = PLANS[options.planName];
  
  let usageCount = options.usageCount || 0;
  let uniqueProductsModified: string[] = [];
  
  // Calculate usage based on options
  if (options.simulateNearLimit) {
    usageCount = Math.floor(plan.usageLimit * 0.85); // 85% of limit
  } else if (options.simulateOverLimit) {
    usageCount = plan.usageLimit + 5; // Over limit
  }
  
  // Generate fake product IDs for usage simulation
  if (usageCount > 0) {
    uniqueProductsModified = Array.from(
      { length: usageCount }, 
      (_, i) => `gid://shopify/Product/test-${i}`
    );
  }
  
  // Reset first if requested
  if (options.resetUsage) {
    await resetUsage(shop);
  }
  
  // Update subscription
  const result = await updateSubscription(shop, {
    planName: plan.name,
    status: "active",
    usageLimit: plan.usageLimit,
    usageCount,
    uniqueProductsModified,
    totalPriceChanges: usageCount * 2, // Simulate multiple changes per product
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  
  console.log(`🧪 Test subscription setup complete:`, {
    plan: plan.displayName,
    usageCount,
    limit: plan.usageLimit,
    percentage: ((usageCount / plan.usageLimit) * 100).toFixed(1) + '%'
  });
  
  return result;
}

/**
 * Create test pricing history entries
 */
export async function createTestHistory(
  shop: string, 
  count: number = 10
) {
  const entries = [];
  
  for (let i = 0; i < count; i++) {
    const actionTypes = ["percentage", "fixed", "add", "subtract"];
    const entry = await db.pricingHistory.create({
      data: {
        shop,
        productId: `gid://shopify/Product/test-${i}`,
        variantId: `gid://shopify/ProductVariant/test-variant-${i}`,
        productTitle: `Test Product ${i + 1}`,
        variantTitle: `Test Variant ${i + 1}`,
        actionType: actionTypes[i % actionTypes.length],
        adjustmentValue: 10 + (i * 2),
        oldPrice: 29.99 + i,
        newPrice: 32.99 + i,
        userEmail: shop,
        createdAt: new Date(Date.now() - (i * 60 * 60 * 1000)) // Spread over hours
      }
    });
    entries.push(entry);
  }
  
  console.log(`🧪 Created ${count} test history entries`);
  return entries;
}

/**
 * Test subscription upgrade scenario
 */
export async function testUpgradeScenario(
  shop: string,
  fromPlan: keyof typeof PLANS,
  toPlan: keyof typeof PLANS,
  currentUsage?: number
) {
  const fromPlanData = PLANS[fromPlan];
  const toPlanData = PLANS[toPlan];
  
  // Set up initial state
  await setupTestSubscription(shop, {
    planName: fromPlan,
    usageCount: currentUsage || Math.floor(fromPlanData.usageLimit * 0.9)
  });
  
  console.log(`🧪 Testing upgrade: ${fromPlanData.displayName} → ${toPlanData.displayName}`);
  
  // Simulate upgrade
  const result = await updateSubscription(shop, {
    planName: toPlanData.name,
    usageLimit: toPlanData.usageLimit,
    status: "active"
    // Note: usageCount and uniqueProductsModified should remain the same during upgrade
  });
  
  console.log(`🧪 Upgrade test complete:`, {
    oldLimit: fromPlanData.usageLimit,
    newLimit: toPlanData.usageLimit,
    currentUsage: result.usageCount,
    newPercentage: ((result.usageCount / result.usageLimit) * 100).toFixed(1) + '%'
  });
  
  return result;
}

/**
 * Clean up all test data
 */
export async function cleanupTestData(shop: string) {
  await Promise.all([
    db.pricingHistory.deleteMany({ where: { shop } }),
    resetUsage(shop)
  ]);
  
  console.log(`🧪 Cleaned up all test data for ${shop}`);
}

/**
 * Simulate product modifications for testing quota
 */
export async function simulateProductModifications(
  shop: string, 
  productCount: number
) {
  const { trackProductModifications } = await import("../models/subscription.server");
  
  const fakeProductIds = Array.from(
    { length: productCount }, 
    (_, i) => `gid://shopify/Product/sim-${Date.now()}-${i}`
  );
  
  const success = await trackProductModifications(shop, fakeProductIds);
  
  console.log(`🧪 Simulated ${productCount} product modifications:`, { success });
  
  return { success, productIds: fakeProductIds };
}

/**
 * Get comprehensive test report
 */
export async function getTestReport(shop: string) {
  const { getUsageStatistics } = await import("../models/subscription.server");
  
  const stats = await getUsageStatistics(shop);
  const recentHistory = await db.pricingHistory.findMany({
    where: { shop },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  
  const report = {
    subscription: stats.subscription,
    usage: stats.currentPeriodStats,
    quota: stats.quotaInfo,
    recentHistory: recentHistory.length,
    testStatus: {
      isNearLimit: stats.quotaInfo.isNearLimit,
      hasReachedLimit: stats.quotaInfo.hasReachedLimit,
      canUpgrade: stats.subscription.planName === 'free'
    }
  };
  
  console.log(`🧪 Test Report for ${shop}:`, report);
  
  return report;
}