// app/lib/plans.ts - Enhanced with better trial support and unlimited display
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
  
  starter: {
    name: "starter",
    displayName: "Starter",
    price: 4.99,
    currency: "USD",
    usageLimit: 500,
    billingInterval: "EVERY_30_DAYS",
    trialDays: 7, // 7-day free trial
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
  
  standard: {
    name: "standard",
    displayName: "Standard",
    price: 9.99,
    currency: "USD",
    usageLimit: 9999999, // Large number for unlimited
    billingInterval: "EVERY_30_DAYS",
    trialDays: 7, // 7-day free trial
    features: [
      "Modify prices for unlimited products",
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

// Function to get a plan
export function getPlan(planName: string): Plan {
  return PLANS[planName] || PLANS.free;
}

// Check feature permissions
export function canUseFeature(subscription: any, feature: string): boolean {
  const plan = getPlan(subscription?.planName || 'free');
  
  // Check product limits
  const uniqueProductsModified = (subscription?.uniqueProductsModified as string[])?.length || 0;
  if (uniqueProductsModified >= plan.usageLimit && plan.usageLimit !== 9999999) {
    return false;
  }
  
  // Feature-specific checks
  switch (feature) {
    case 'advanced_filters':
      return plan.name !== 'free';
    case 'csv_export':
      return ['starter', 'standard'].includes(plan.name);
    case 'bulk_operations':
      return ['standard'].includes(plan.name);
    case 'unlimited_products':
      return plan.usageLimit === 9999999;
    case 'priority_support':
      return plan.name !== 'free';
    case 'analytics':
      return ['standard'].includes(plan.name);
    case 'scheduled_updates':
      return ['standard'].includes(plan.name);
    default:
      return true;
  }
}

// Enhanced format display for unlimited plans
export function formatPriceDisplay(price: number, currency: string = "USD"): string {
  if (price === 0) return "Free";
  
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
  });
  
  return `${formatter.format(price)}/month`;
}

// ✅ NEW: Format usage limit display
export function formatUsageLimit(usageLimit: number): string {
  if (usageLimit === 9999999) {
    return "unlimited";
  }
  return usageLimit.toString();
}

// ✅ NEW: Format usage display for UI
export function formatUsageDisplay(current: number, limit: number): string {
  if (limit === 9999999) {
    return `${current} / unlimited`;
  }
  return `${current} / ${limit}`;
}

// Get upgrade recommendations
export function getUpgradeRecommendation(subscription: any): {
  shouldUpgrade: boolean;
  reason: string;
  recommendedPlan: string;
} {
  const currentPlan = getPlan(subscription?.planName || 'free');
  const uniqueProductsModified = (subscription?.uniqueProductsModified as string[])?.length || 0;
  const usagePercentage = currentPlan.usageLimit === 9999999 ? 0 : (uniqueProductsModified / currentPlan.usageLimit) * 100;

  if (currentPlan.name === 'free' && usagePercentage > 80) {
    return {
      shouldUpgrade: true,
      reason: `You've modified ${uniqueProductsModified} of ${currentPlan.usageLimit} allowed products this month. Upgrade to modify more products without interruption.`,
      recommendedPlan: 'starter'
    };
  }

  if (currentPlan.name === 'starter' && usagePercentage > 85) {
    return {
      shouldUpgrade: true,
      reason: `You're approaching your limit. Upgrade to Standard for unlimited products and advanced features.`,
      recommendedPlan: 'standard'
    };
  }

  return {
    shouldUpgrade: false,
    reason: "Your current plan meets your needs.",
    recommendedPlan: currentPlan.name
  };
}

// ✅ ENHANCED: Better trial eligibility check
export function isEligibleForTrial(subscription: any, planName: string): boolean {
  const plan = getPlan(planName);
  
  // No trial for free plan
  if (plan.name === 'free') return false;
  
  // No trial defined for this plan
  if (!plan.trialDays) return false;
  
  // Check if user has never had a paid plan
  const hasHadPaidPlan = subscription?.planName !== 'free' || 
                        subscription?.subscriptionId !== null;

  if (hasHadPaidPlan) return false;
  
  // Check if usage is low (new users)
  const usageCount = subscription?.usageCount || 0;
  if (usageCount > 10) return false; // More than 10 products modified = not new
  
  // Check account age (if created very recently, likely eligible)
  const createdAt = new Date(subscription?.createdAt || Date.now());
  const daysSinceCreation = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  
  // Eligible if account is less than 30 days old and meets other criteria
  return daysSinceCreation <= 30;
}

// ✅ ENHANCED: Get price display with trial information
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

// Calculate product usage impact
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
  
  // ✅ Handle unlimited plans
  const wouldExceed = usageLimit === 9999999 ? false : totalAfter > usageLimit;
  const remaining = usageLimit === 9999999 ? 9999999 : Math.max(0, usageLimit - totalAfter);
  
  return {
    wouldExceed,
    newProductsCount: newProducts.length,
    totalAfter,
    remaining
  };
}

// ✅ NEW: Check if plan has unlimited products
export function hasUnlimitedProducts(planName: string): boolean {
  const plan = getPlan(planName);
  return plan.usageLimit === 9999999;
}

// ✅ NEW: Get plan limits for display
export function getPlanLimits(planName: string): {
  usageLimit: number;
  displayLimit: string;
  isUnlimited: boolean;
} {
  const plan = getPlan(planName);
  const isUnlimited = plan.usageLimit === 9999999;
  
  return {
    usageLimit: plan.usageLimit,
    displayLimit: isUnlimited ? "unlimited" : plan.usageLimit.toString(),
    isUnlimited
  };
}

// Get annual discount calculations (for future use)
export function getAnnualDiscount(plan: Plan): {
  monthlyPrice: number;
  annualPrice: number;
  savings: number;
  savingsPercentage: number;
} {
  const monthlyPrice = plan.price;
  const annualPrice = monthlyPrice * 10; // 2 months free
  const savings = monthlyPrice * 2;
  const savingsPercentage = (savings / (monthlyPrice * 12)) * 100;
  
  return {
    monthlyPrice,
    annualPrice,
    savings,
    savingsPercentage: Math.round(savingsPercentage)
  };
}