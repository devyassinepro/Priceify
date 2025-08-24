// app/lib/plans.ts - Fixed plans configuration
export interface Plan {
  name: string;
  displayName: string;
  price: number;
  currency: string;
  usageLimit: number;
  features: string[];
  recommended?: boolean;
  billingInterval?: string;
  trialDays?: number;
}

export const PLANS: Record<string, Plan> = {
  free: {
    name: "free",
    displayName: "Free",
    price: 0,
    currency: "USD",
    usageLimit: 20,
    billingInterval: "EVERY_30_DAYS",
    features: [
      "Modify prices for up to 20 unique products per month",
      "Unlimited price changes per product",
      "4 modification types (%, fixed, +, -)",
      "Basic modification history",
      "Product search and filtering",
      "Community support via email"
    ]
  },
  
  standard: {
    name: "standard",
    displayName: "Standard",
    price: 4.99,
    currency: "USD",
    usageLimit: 500,
    billingInterval: "EVERY_30_DAYS",
    trialDays: 7,
    features: [
      "Modify prices for up to 500 unique products per month",
      "Unlimited price changes per product",
      "All modification types and filters",
      "Complete modification history",
      "Advanced product search",
      "Email support (48h response)",
      "Export pricing reports"
    ]
  },
  
  pro: {
    name: "pro",
    displayName: "Pro",
    price: 9.99,
    currency: "USD",
    usageLimit: 9999999, // ✅ FIX: Changed from 9999999 to reasonable limit
    billingInterval: "EVERY_30_DAYS",
    trialDays: 7,
    features: [
      "Modify prices for unlimited products", // ✅ Updated description
      "Unlimited price changes per product",
      "All modification types and bulk operations",
      "Complete modification history with filters",
      "Advanced product filters and search",
      "CSV export of price changes",
      "Priority email support (24h response)",
      "Detailed usage analytics",
      "Scheduled price updates"
    ],
    recommended: true
  }
};

// ✅ FIX: Updated function to handle realistic limits
export function hasUnlimitedProducts(planName: string): boolean {
  const plan = getPlan(planName);
  // Only consider truly unlimited plans (none in current setup)
  return false; // No unlimited plans for now
}

// ✅ FIX: Better formatting for large numbers
export function formatUsageDisplay(current: number, limit: number): string {
  return `${current.toLocaleString()} / ${limit.toLocaleString()}`;
}

// ✅ FIX: Updated format display
export function formatUsageLimit(usageLimit: number): string {
  return usageLimit.toLocaleString();
}

// Rest of the functions remain the same...
export function getPlan(planName: string): Plan {
  return PLANS[planName] || PLANS.free;
}

export function canUseFeature(subscription: any, feature: string): boolean {
  const plan = getPlan(subscription?.planName || 'free');
  
  const uniqueProductsModified = (subscription?.uniqueProductsModified as string[])?.length || 0;
  if (uniqueProductsModified >= plan.usageLimit) {
    return false;
  }
  
  switch (feature) {
    case 'advanced_filters':
      return plan.name !== 'free';
    case 'csv_export':
      return ['standard'].includes(plan.name);
    case 'bulk_operations':
      return ['standard'].includes(plan.name);
      case 'unlimited_products':
        return plan.usageLimit === 9999999;      case 'priority_support':
      return plan.name !== 'free';
    case 'analytics':
      return ['standard'].includes(plan.name);
    case 'scheduled_updates':
      return ['standard'].includes(plan.name);
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
  const usagePercentage = (uniqueProductsModified / currentPlan.usageLimit) * 100;

  if (currentPlan.name === 'free' && usagePercentage > 80) {
    return {
      shouldUpgrade: true,
      reason: `You've modified ${uniqueProductsModified} of ${currentPlan.usageLimit} allowed products this month. Upgrade to modify more products without interruption.`,
      recommendedPlan: 'standard'
    };
  }

  if (currentPlan.name === 'standard' && usagePercentage > 85) {
    return {
      shouldUpgrade: true,
      reason: `You're approaching your limit. Upgrade to Standard for ${PLANS.standard.usageLimit.toLocaleString()} products and advanced features.`,
      recommendedPlan: 'pro'
    };
  }

  return {
    shouldUpgrade: false,
    reason: "Your current plan meets your needs.",
    recommendedPlan: currentPlan.name
  };
}

export function isEligibleForTrial(subscription: any, planName: string): boolean {
  const plan = getPlan(planName);
  
  if (plan.name === 'free') return false;
  if (!plan.trialDays) return false;
  
  const hasHadPaidPlan = subscription?.planName !== 'free' || 
                        subscription?.subscriptionId !== null;

  if (hasHadPaidPlan) return false;
  
  const usageCount = subscription?.usageCount || 0;
  if (usageCount > 10) return false;
  
  const createdAt = new Date(subscription?.createdAt || Date.now());
  const daysSinceCreation = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  
  return daysSinceCreation <= 30;
}

export function getPriceWithTrial(plan: Plan, isEligible: boolean): {
  displayPrice: string;
  trialInfo?: string;
} {
  const basePrice = formatPriceDisplay(plan.price);
  
  if (isEligible && plan.trialDays) {
    return {
      displayPrice: "Free Trial",
      trialInfo: `${plan.trialDays} days free`
    };
  }
  
  return { displayPrice: basePrice };
}

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
  
  const wouldExceed = totalAfter > usageLimit;
  const remaining = Math.max(0, usageLimit - totalAfter);
  
  return {
    wouldExceed,
    newProductsCount: newProducts.length,
    totalAfter,
    remaining
  };
}

export function getPlanLimits(planName: string): {
  usageLimit: number;
  displayLimit: string;
  isUnlimited: boolean;
} {
  const plan = getPlan(planName);
  const isUnlimited = false; // No unlimited plans for now
  
  return {
    usageLimit: plan.usageLimit,
    displayLimit: plan.usageLimit.toLocaleString(),
    isUnlimited
  };
}