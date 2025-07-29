// app/lib/plans.ts - Updated plans with product-based limits

export interface Plan {
  name: string;
  displayName: string;
  price: number;
  currency: string;
  usageLimit: number; // Now represents unique products, not price changes
  features: string[];
  recommended?: boolean;
  billingInterval?: string;
}

export const PLANS: Record<string, Plan> = {
  free: {
    name: "free",
    displayName: "Free",
    price: 0,
    currency: "USD",
    usageLimit: 20, // 20 unique products per month
    billingInterval: "EVERY_30_DAYS",
    features: [
      "Modify prices for up to 20 unique products per month",
      "Unlimited price changes per product (within the month)",
      "4 modification types (%, fixed, +, -)",
      "Basic modification history",
      "Product search and filtering",
      "Community support via email"
    ]
  },
  
  standard: {
    name: "standard",
    displayName: "Standard",
    price: 4.99, // Match the price from your email
    currency: "USD",
    usageLimit: 500, // 500 unique products per month
    billingInterval: "EVERY_30_DAYS",
    features: [
      "Modify prices for up to 500 unique products per month",
      "Unlimited price changes per product (within the month)",
      "All modification types and bulk operations",
      "Complete modification history with filters",
      "Advanced product filters and search",
      "CSV export of price changes",
      "Priority email support (48h response)",
      "Detailed usage analytics"
    ],
    recommended: true
  },
  
  pro: {
    name: "pro",
    displayName: "Professional", 
    price: 9.99, // Updated to match your configuration
    currency: "USD",
    usageLimit: 99999, // Unlimited products
    billingInterval: "EVERY_30_DAYS",
    features: [
      "Modify prices for unlimited products",
      "Unlimited price changes per product",
      "Bulk operations on 1000+ products",
      "Advanced analytics and profit insights", 
      "API access for custom integrations",
      "Priority support (24h response time)",
      "Custom pricing rules and automation",
      "White-label reports and data export",
      "Advanced competitor price tracking"
    ]
  }
};
// Rest of the file remains the same
export function getPlan(planName: string): Plan {
  return PLANS[planName] || PLANS.free;
}

export function canUseFeature(subscription: any, feature: string): boolean {
  const plan = getPlan(subscription?.planName || 'free');
  
  // Check product limits (not individual price change limits)
  const uniqueProductsModified = (subscription?.uniqueProductsModified as string[])?.length || 0;
  if (uniqueProductsModified >= plan.usageLimit) {
    return false;
  }
  
  // Feature-specific checks
  switch (feature) {
    case 'advanced_filters':
      return plan.name !== 'free';
    case 'csv_export':
      return plan.name === 'standard' || plan.name === 'pro';
    case 'bulk_operations':
      return plan.name === 'pro';
    case 'api_access':
      return plan.name === 'pro';
    case 'unlimited_products':
      return plan.name === 'pro';
    case 'priority_support':
      return plan.name !== 'free';
    case 'analytics':
      return plan.name === 'pro';
    case 'automation':
      return plan.name === 'pro';
    default:
      return true;
  }
}

export function formatPriceDisplay(price: number, currency: string = "USD"): string {
  if (price === 0) return "Free";
  
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
  });
  
  return `${formatter.format(price)}/month`;
}

export function getUpgradeRecommendation(subscription: any): {
  shouldUpgrade: boolean;
  reason: string;
  recommendedPlan: string;
} {
  const currentPlan = getPlan(subscription?.planName || 'free');
  const uniqueProductsModified = (subscription?.uniqueProductsModified as string[])?.length || 0;
  const usagePercentage = (uniqueProductsModified / subscription.usageLimit) * 100;

  if (currentPlan.name === 'free' && usagePercentage > 80) {
    return {
      shouldUpgrade: true,
      reason: `You've modified ${uniqueProductsModified} of ${subscription.usageLimit} allowed products this month. Upgrade to modify more products without interruption.`,
      recommendedPlan: 'standard'
    };
  }

  if (currentPlan.name === 'standard' && usagePercentage > 90) {
    return {
      shouldUpgrade: true,
      reason: `You're a power user! Upgrade to Pro for unlimited product modifications and advanced features.`,
      recommendedPlan: 'pro'
    };
  }

  return {
    shouldUpgrade: false,
    reason: "Your current plan meets your needs.",
    recommendedPlan: currentPlan.name
  };
}

/**
 * Helper function to estimate if a bulk operation would exceed limits
 */
export function estimateProductUsage(
  currentProductsModified: string[], 
  newProductIds: string[], 
  usageLimit: number
): {
  wouldExceed: boolean;
  newProductsCount: number;
  totalAfter: number;
  remaining: number;
} {
  const newProducts = newProductIds.filter(id => !currentProductsModified.includes(id));
  const totalAfter = currentProductsModified.length + newProducts.length;
  
  return {
    wouldExceed: totalAfter > usageLimit,
    newProductsCount: newProducts.length,
    totalAfter,
    remaining: Math.max(0, usageLimit - totalAfter)
  };
}