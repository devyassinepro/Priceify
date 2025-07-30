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
    // Si erreur de contrainte unique, récupérer l'abonnement existant
    if (error.code === 'P2002') {
      console.log(`Abonnement existe déjà pour ${shop}, récupération...`);
      const existingSubscription = await db.subscription.findUnique({
        where: { shop },
      });
      
      if (existingSubscription) {
        return existingSubscription;
      }
    }
    
    // Si autre erreur, la propager
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
  usageCount?: number; // ← Add this missing field
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
    usageCount: result.usageCount, // ← Also log this
    status: result.status
  });
  
  return result;
}


/**
 * Track product modifications - now counts unique products instead of individual changes
 * @param shop - Shop domain
 * @param productIds - Array of product IDs being modified
 * @returns boolean - Whether the operation is within limits
 */
export async function trackProductModifications(shop: string, productIds: string[]): Promise<boolean> {
  const subscription = await getOrCreateSubscription(shop);
  
  // Get current unique products modified this period
  const currentProducts = (subscription.uniqueProductsModified as string[]) || [];
  
  // Add new product IDs to the set (avoiding duplicates)
  const updatedProducts = Array.from(new Set([...currentProducts, ...productIds]));
  
  // Check if this would exceed the limit
  if (updatedProducts.length > subscription.usageLimit) {
    return false; // Would exceed limit
  }
  
  // Update the subscription with new product list and count
  await db.subscription.update({
    where: { shop },
    data: {
      uniqueProductsModified: updatedProducts,
      usageCount: updatedProducts.length,
      // Optionally increment total price changes for analytics
      totalPriceChanges: {
        increment: productIds.length
      }
    },
  });
  
  return true; // Within limits
}

/**
 * Check if adding new product modifications would exceed limits
 * @param shop - Shop domain  
 * @param productIds - Product IDs to be modified
 * @returns boolean - Whether this would exceed limits
 */
export async function wouldExceedProductLimit(shop: string, productIds: string[]): Promise<boolean> {
  const subscription = await getOrCreateSubscription(shop);
  const currentProducts = (subscription.uniqueProductsModified as string[]) || [];
  const updatedProducts = Array.from(new Set([...currentProducts, ...productIds]));
  
  return updatedProducts.length > subscription.usageLimit;
}

/**
 * Legacy function for backward compatibility - now uses product-based tracking
 * @deprecated Use trackProductModifications instead
 */
export async function incrementUsage(shop: string): Promise<boolean> {
  const subscription = await getOrCreateSubscription(shop);
  
  if (subscription.usageCount >= subscription.usageLimit) {
    return false; // Usage limit reached
  }
  
  // This function is now deprecated, but we keep it for compatibility
  // In practice, trackProductModifications should be used instead
  await db.subscription.update({
    where: { shop },
    data: {
      usageCount: { increment: 1 },
      totalPriceChanges: { increment: 1 }
    },
  });
  
  return true;
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
 * Get list of products modified this period for display purposes
 */
export async function getModifiedProductsThisPeriod(shop: string): Promise<string[]> {
  const subscription = await getOrCreateSubscription(shop);
  return (subscription.uniqueProductsModified as string[]) || [];
}

export async function getSubscriptionStats(shop: string) {
  const subscription = await getOrCreateSubscription(shop);
  const plan = PLANS[subscription.planName];
  
  return {
    ...subscription,
    plan,
    usagePercentage: (subscription.usageCount / subscription.usageLimit) * 100,
    remainingUsage: subscription.usageLimit - subscription.usageCount,
    // Add helper for unique products tracking
    uniqueProductCount: ((subscription.uniqueProductsModified as string[]) || []).length,
    remainingProducts: subscription.usageLimit - ((subscription.uniqueProductsModified as string[]) || []).length,
  };
}


/**
 * Calculate the impact of a potential bulk selection on quota
 * @param shop - Shop domain
 * @param productIds - Product IDs to be potentially modified
 * @returns Object with quota impact details
 */
export async function calculateQuotaImpact(shop: string, productIds: string[]): Promise<{
  currentProducts: string[];
  newProducts: string[];
  alreadyModified: string[];
  quotaImpact: number;
  wouldExceed: boolean;
  remainingAfter: number;
}> {
  const subscription = await getOrCreateSubscription(shop);
  const currentProducts = (subscription.uniqueProductsModified as string[]) || [];
  
  const newProducts = productIds.filter(id => !currentProducts.includes(id));
  const alreadyModified = productIds.filter(id => currentProducts.includes(id));
  const totalAfter = currentProducts.length + newProducts.length;
  
  return {
    currentProducts,
    newProducts,
    alreadyModified,
    quotaImpact: newProducts.length,
    wouldExceed: totalAfter > subscription.usageLimit,
    remainingAfter: subscription.usageLimit - totalAfter
  };
}

/**
 * Force refresh subscription data from database
 * Useful after external updates or migrations
 */
export async function refreshSubscription(shop: string) {
  // Clear any potential cache and fetch fresh data
  return await db.subscription.findUnique({
    where: { shop },
  });
}

/**
 * Get usage statistics for admin/analytics purposes
 */
export async function getUsageStatistics(shop: string) {
  const subscription = await getOrCreateSubscription(shop);
  const currentProducts = (subscription.uniqueProductsModified as string[]) || [];
  
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
  
  // Calculate statistics
  const uniqueProductsFromHistory = new Set(recentHistory.map(h => h.productId)).size;
  const totalChangesFromHistory = recentHistory.length;
  const averageChangesPerProduct = uniqueProductsFromHistory > 0 
    ? totalChangesFromHistory / uniqueProductsFromHistory 
    : 0;
  
  return {
    subscription,
    currentPeriodStats: {
      uniqueProductsModified: currentProducts.length,
      totalPriceChanges: subscription.totalPriceChanges || 0,
      averageChangesPerProduct: averageChangesPerProduct.toFixed(2),
    },
    historyStats: {
      uniqueProductsFromHistory,
      totalChangesFromHistory,
      discrepancy: Math.abs(currentProducts.length - uniqueProductsFromHistory)
    },
    quotaInfo: {
      usagePercentage: (currentProducts.length / subscription.usageLimit) * 100,
      remainingProducts: subscription.usageLimit - currentProducts.length,
      isNearLimit: (currentProducts.length / subscription.usageLimit) > 0.8,
      hasReachedLimit: currentProducts.length >= subscription.usageLimit
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
      usageCount: uniqueProducts.length,
      totalPriceChanges: totalChanges,
      updatedAt: new Date()
    }
  });
}