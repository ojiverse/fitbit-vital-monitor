import { z } from "zod";

const numericOrNull = z.union([z.number(), z.null()]).optional();

export const heartRateIntradaySchema = z.object({
  "activities-heart": z
    .array(
      z.object({
        dateTime: z.string(),
        value: z.object({
          restingHeartRate: numericOrNull,
        }),
      }),
    )
    .default([]),
  "activities-heart-intraday": z
    .object({
      dataset: z
        .array(
          z.object({
            time: z.string(),
            value: z.number(),
          }),
        )
        .default([]),
    })
    .default({ dataset: [] }),
});

export const activityDailySummarySchema = z.object({
  summary: z.object({
    steps: z.number().default(0),
    caloriesOut: z.number().default(0),
    floors: z.number().default(0),
    distances: z.array(z.object({ activity: z.string(), distance: z.number() })).default([]),
  }),
});

const azmZones = z.object({
  fatBurnActiveZoneMinutes: z.number().optional(),
  cardioActiveZoneMinutes: z.number().optional(),
  peakActiveZoneMinutes: z.number().optional(),
  activeZoneMinutes: z.number().optional(),
});

export const azmIntradaySchema = z.object({
  "activities-active-zone-minutes": z
    .array(
      z.object({
        dateTime: z.string(),
        value: azmZones,
      }),
    )
    .default([]),
});

export const breathingRateSchema = z.object({
  br: z
    .array(
      z.object({
        dateTime: z.string(),
        value: z.object({ breathingRate: z.number() }),
      }),
    )
    .default([]),
});

export const spo2DailySchema = z.union([
  z.object({
    dateTime: z.string(),
    value: z.object({ avg: z.number(), min: z.number(), max: z.number() }),
  }),
  z.array(
    z.object({
      dateTime: z.string(),
      value: z.object({ avg: z.number(), min: z.number(), max: z.number() }),
    }),
  ),
]);

export const hrvSchema = z.object({
  hrv: z
    .array(
      z.object({
        dateTime: z.string(),
        value: z.object({
          dailyRmssd: z.number(),
          deepRmssd: z.number().optional(),
        }),
      }),
    )
    .default([]),
});

export const skinTempSchema = z.object({
  tempSkin: z
    .array(
      z.object({
        dateTime: z.string(),
        value: z.object({ nightlyRelative: z.number() }),
      }),
    )
    .default([]),
});

export const cardioScoreSchema = z.object({
  cardioScore: z
    .array(
      z.object({
        dateTime: z.string(),
        value: z.object({ vo2Max: z.union([z.string(), z.number()]) }),
      }),
    )
    .default([]),
});

export const sleepSchema = z.object({
  sleep: z
    .array(
      z.object({
        isMainSleep: z.boolean().optional(),
        duration: z.number(),
        efficiency: z.number(),
        startTime: z.string(),
        endTime: z.string(),
        levels: z
          .object({
            summary: z
              .object({
                deep: z.object({ minutes: z.number() }).optional(),
                light: z.object({ minutes: z.number() }).optional(),
                rem: z.object({ minutes: z.number() }).optional(),
                wake: z.object({ minutes: z.number() }).optional(),
              })
              .optional(),
            data: z
              .array(
                z.object({
                  dateTime: z.string(),
                  level: z.string(),
                  seconds: z.number(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
  summary: z
    .object({
      totalMinutesAsleep: z.number().optional(),
      totalTimeInBed: z.number().optional(),
    })
    .optional(),
});

export const weightLogSchema = z.object({
  weight: z
    .array(
      z.object({
        date: z.string(),
        time: z.string().optional(),
        weight: z.number(),
        bmi: z.number().optional(),
        fat: z.number().optional(),
      }),
    )
    .default([]),
});

export const devicesSchema = z.array(
  z.object({
    id: z.string(),
    type: z.string().default("TRACKER"),
    deviceVersion: z.string().default(""),
    batteryLevel: z.number().optional(),
    battery: z.string().optional(),
    lastSyncTime: z.string(),
  }),
);

export const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  scope: z.string(),
  token_type: z.string(),
  user_id: z.string(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;
