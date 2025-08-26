// app/models/subscription.server.ts - COMPLETE FILE with modification tracking
import { db } from "../db.server";
import { PLANS } from "../lib/plans";

export async function getOrCreateSubscription(shop: string) {
  try {
    let subscription = await db.subscription.findUnique({
      where: { shop },
    });
    
    if (!subscription) {
      subscription = await db.subscription.create({
        data: {
          shop,
          planName: "free",
          status: "active",
          usageLimit: 20,
          usageCount: 0,
          uniqueProductsModified: [],
          totalPriceChanges: 0,
        },
      });
    }
    
    return subscription;
  } catch (error: any) {
    if (error.code === 'P2002') {
      console.log(`Subscription exists for ${shop}, fetching...`);
      const existingSubscription = await db.subscription.findUnique({
        where: { shop },
      });
      
      if (existingSubscription) {
        return existingSubscription;
      }
    }
    
    throw error;
  }
}

export async function updateSubscription(shop: string, data: {
  planName?: string;
  status?: string;
  subscriptionId?: string;
  usageLimit?: number;
  currentPeriodEnd?: Date;
  uniqueProductsModified?: string[];
  totalPriceChanges?: number;
  usageCount?: number;
}) {
  console.log(`🔄 Updating subscription for ${shop}:`, JSON.stringify(data, null, 2));
  
  const result = await db.subscription.update({
    where: { shop },
    data: {
      ...data,
      updatedAt: new Date(),
    },
  });
  
  console.log(`✅ Subscription updated successfully:`, {
    shop: result.shop,
    planName: result.planName,
    usageLimit: result.usageLimit,
    usageCount: result.usageCount,
    uniqueProductsCount: ((result.uniqueProductsModified as string[]) || []).length,
    status: result.status
  });
  
  return result;
}

/**
 * ✅ NEW: Track ALL product modifications (not just unique ones)
 * This increments the counter for EVERY product modification
 */
export async function trackAllProductModifications(shop: string, productIds: string[]): Promise<boolean> {
  const subscription = await getOrCreateSubscription(shop);
  
  // Calculate how many products we're about to modify
  const modificationsToAdd = productIds.length;
  const newTotalCount = subscription.usageCount + modificationsToAdd;
  
  console.log(`📊 Tracking ${modificationsToAdd} product modifications for ${shop}`);
  console.log(`📈 Current: ${subscription.usageCount}, Adding: ${modificationsToAdd}, New Total: ${newTotalCount}`);
  
  // Check if this would exceed the limit
  if (newTotalCount > subscription.usageLimit) {
    console.log(`❌ Would exceed limit: ${newTotalCount} > ${subscription.usageLimit}`);
    return false; // Would exceed limit
  }
  
  // Update the usage count with ALL modifications
  await db.subscription.update({
    where: { shop },
    data: {
      usageCount: newTotalCount,
      // Also track total price changes for analytics
      totalPriceChanges: {
        increment: modificationsToAdd
      },
      updatedAt: new Date(),
    },
  });
  
  console.log(`✅ Product modifications tracked:`, {
    shop,
    addedModifications: modificationsToAdd,
    newTotalCount,
    remainingCapacity: subscription.usageLimit - newTotalCount
  });
  
  return true; // Within limits
}

/**
 * ✅ KEEP: Original function for unique product tracking (for analytics)
 * This maintains the list of unique products modified this period
 */
export async function trackUniqueProducts(shop: string, productIds: string[]): Promise<void> {
  const subscription = await getOrCreateSubscription(shop);
  
  // Get current unique products modified this period
  const currentUniqueProducts = (subscription.uniqueProductsModified as string[]) || [];
  
  // Add new product IDs to the set (avoiding duplicates)
  const updatedUniqueProducts = Array.from(new Set([...currentUniqueProducts, ...productIds]));
  
  // Update only if there are new unique products
  if (updatedUniqueProducts.length > currentUniqueProducts.length) {
    await db.subscription.update({
      where: { shop },
      data: {
        uniqueProductsModified: updatedUniqueProducts,
        updatedAt: new Date(),
      },
    });
    
    console.log(`📋 Unique products updated: ${currentUniqueProducts.length} → ${updatedUniqueProducts.length}`);
  }
}

/**
 * ✅ DEPRECATED: Old function - kept for backwards compatibility
 * Use trackAllProductModifications instead
 */
export async function trackProductModifications(shop: string, productIds: string[]): Promise<boolean> {
  console.warn("⚠️ trackProductModifications is deprecated, use trackAllProductModifications instead");
  return await trackAllProductModifications(shop, productIds);
}

/**
 * Check if adding new product modifications would exceed limits
 */
export async function wouldExceedProductLimit(shop: string, productIds: string[]): Promise<boolean> {
  const subscription = await getOrCreateSubscription(shop);
  const modificationsToAdd = productIds.length;
  const newTotalCount = subscription.usageCount + modificationsToAdd;
  
  return newTotalCount > subscription.usageLimit;
}

/**
 * ✅ NEW: Get modification statistics
 */
export async function getModificationStats(shop: string): Promise<{
  totalModifications: number;
  uniqueProducts: number;
  averageModificationsPerProduct: number;
  remainingCapacity: number;
  usagePercentage: number;
}> {
  const subscription = await getOrCreateSubscription(shop);
  const uniqueProducts = (subscription.uniqueProductsModified as string[]) || [];
  
  const totalModifications = subscription.usageCount;
  const uniqueProductCount = uniqueProducts.length;
  const averageModificationsPerProduct = uniqueProductCount > 0 ? totalModifications / uniqueProductCount : 0;
  const remainingCapacity = subscription.usageLimit - totalModifications;
  const usagePercentage = (totalModifications / subscription.usageLimit) * 100;
  
  return {
    totalModifications,
    uniqueProducts: uniqueProductCount,
    averageModificationsPerProduct: parseFloat(averageModificationsPerProduct.toFixed(2)),
    remainingCapacity: Math.max(0, remainingCapacity),
    usagePercentage: parseFloat(usagePercentage.toFixed(1))
  };
}

/**
 * Force sync usageCount - now this just ensures data consistency
 */
export async function syncUsageCount(shop: string) {
  const subscription = await getOrCreateSubscription(shop);
  
  // With the new system, usageCount should always be accurate
  // This function now just validates consistency
  console.log(`ℹ️ Usage count for ${shop}: ${subscription.usageCount} (no sync needed with new system)`);
  
  return { 
    synced: false, 
    count: subscription.usageCount,
    message: "New system maintains accurate count automatically"
  };
}

export async function resetUsage(shop: string) {
  return await db.subscription.update({
    where: { shop },
    data: {
      usageCount: 0,
      uniqueProductsModified: [],
      totalPriceChanges: 0,
    },
  });
}

export async function checkUsageLimit(shop: string): Promise<boolean> {
  const subscription = await getOrCreateSubscription(shop);
  return subscription.usageCount >= subscription.usageLimit;
}

/**
 * Get list of unique products modified this period (for analytics)
 */
export async function getModifiedProductsThisPeriod(shop: string): Promise<string[]> {
  const subscription = await getOrCreateSubscription(shop);
  return (subscription.uniqueProductsModified as string[]) || [];
}

export async function getSubscriptionStats(shop: string) {
  const subscription = await getOrCreateSubscription(shop);
  const plan = PLANS[subscription.planName];
  const stats = await getModificationStats(shop);
  
  return {
    ...subscription,
    plan,
    usagePercentage: stats.usagePercentage,
    remainingUsage: stats.remainingCapacity,
    // Analytics data
    uniqueProductCount: stats.uniqueProducts,
    averageModificationsPerProduct: stats.averageModificationsPerProduct,
  };
}

/**
 * Calculate the impact of a potential bulk selection on quota
 */
export async function calculateQuotaImpact(shop: string, productIds: string[]): Promise<{
  currentUsage: number;
  modificationsToAdd: number;
  totalAfter: number;
  wouldExceed: boolean;
  remainingAfter: number;
}> {
  const subscription = await getOrCreateSubscription(shop);
  
  const currentUsage = subscription.usageCount;
  const modificationsToAdd = productIds.length;
  const totalAfter = currentUsage + modificationsToAdd;
  
  return {
    currentUsage,
    modificationsToAdd,
    totalAfter,
    wouldExceed: totalAfter > subscription.usageLimit,
    remainingAfter: subscription.usageLimit - totalAfter
  };
}

/**
 * Force refresh subscription data from database
 */
export async function refreshSubscription(shop: string) {
  return await db.subscription.findUnique({
    where: { shop },
  });
}

/**
 * Enhanced usage statistics with the new tracking system
 */
export async function getUsageStatistics(shop: string) {
  const subscription = await getOrCreateSubscription(shop);
  const modificationStats = await getModificationStats(shop);
  
  // Get recent pricing history for additional analytics
  const recentHistory = await db.pricingHistory.findMany({
    where: {
      shop,
      createdAt: {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
      }
    },
    orderBy: { createdAt: 'desc' },
  });
  
  // Calculate statistics from history
  const uniqueProductsFromHistory = new Set(recentHistory.map(h => h.productId)).size;
  const totalChangesFromHistory = recentHistory.length;
  
  return {
    subscription,
    currentPeriodStats: {
      totalModifications: modificationStats.totalModifications,
      uniqueProducts: modificationStats.uniqueProducts,
      averageModificationsPerProduct: modificationStats.averageModificationsPerProduct,
      totalPriceChanges: subscription.totalPriceChanges || 0,
    },
    historyStats: {
      uniqueProductsFromHistory,
      totalChangesFromHistory,
      historyVsTracking: {
        trackingTotal: modificationStats.totalModifications,
        historyTotal: totalChangesFromHistory,
        difference: Math.abs(modificationStats.totalModifications - totalChangesFromHistory)
      }
    },
    quotaInfo: {
      usagePercentage: modificationStats.usagePercentage,
      remainingCapacity: modificationStats.remainingCapacity,
      isNearLimit: modificationStats.usagePercentage > 80,
      hasReachedLimit: modificationStats.totalModifications >= subscription.usageLimit
    }
  };
}

/**
 * Sync subscription data with pricing history
 * Useful for data consistency checks or after manual database changes
 */
export async function syncSubscriptionWithHistory(shop: string) {
  const subscription = await getOrCreateSubscription(shop);
  
  // Get unique products from last 30 days of history
  const recentHistory = await db.pricingHistory.findMany({
    where: {
      shop,
      createdAt: {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      }
    },
    select: {
      productId: true,
      createdAt: true
    }
  });
  
  const uniqueProducts = Array.from(new Set(recentHistory.map(h => h.productId)));
  const totalChanges = recentHistory.length;
  
  // Update subscription with synced data
  return await db.subscription.update({
    where: { shop },
    data: {
      uniqueProductsModified: uniqueProducts,
      // Note: We don't automatically sync usageCount from history 
      // as it might interfere with the current tracking system
      totalPriceChanges: totalChanges,
      updatedAt: new Date()
    }
  });
}