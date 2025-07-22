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
}) {
  return await db.subscription.update({
    where: { shop },
    data: {
      ...data,
      updatedAt: new Date(),
    },
  });
}

export async function incrementUsage(shop: string): Promise<boolean> {
  const subscription = await getOrCreateSubscription(shop);
  
  if (subscription.usageCount >= subscription.usageLimit) {
    return false; // Usage limit reached
  }
  
  await db.subscription.update({
    where: { shop },
    data: {
      usageCount: { increment: 1 },
    },
  });
  
  return true;
}

export async function resetUsage(shop: string) {
  return await db.subscription.update({
    where: { shop },
    data: {
      usageCount: 0,
    },
  });
}

export async function checkUsageLimit(shop: string): Promise<boolean> {
  const subscription = await getOrCreateSubscription(shop);
  return subscription.usageCount >= subscription.usageLimit;
}

export async function getSubscriptionStats(shop: string) {
  const subscription = await getOrCreateSubscription(shop);
  const plan = PLANS[subscription.planName];
  
  return {
    ...subscription,
    plan,
    usagePercentage: (subscription.usageCount / subscription.usageLimit) * 100,
    remainingUsage: subscription.usageLimit - subscription.usageCount,
  };
}