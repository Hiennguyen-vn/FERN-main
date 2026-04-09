package com.fern.simulator.engine;

import java.util.Random;

/**
 * Seeded random number generator for deterministic, reproducible simulations.
 * <p>
 * Given the same seed, all calls produce the same sequence of results.
 * This is critical for the deterministic replay resume strategy.
 */
public final class SimulationRandom {

    private final Random random;
    private final long seed;

    public SimulationRandom(long seed) {
        this.seed = seed;
        this.random = new Random(seed);
    }

    public long getSeed() {
        return seed;
    }

    /** Returns true with the given probability (0.0–1.0). */
    public boolean chance(double probability) {
        return random.nextDouble() < probability;
    }

    /** Returns a random int in [min, max] inclusive. */
    public int intBetween(int min, int max) {
        if (min == max) return min;
        return min + random.nextInt(max - min + 1);
    }

    /** Returns a random double in [min, max). */
    public double doubleBetween(double min, double max) {
        return min + random.nextDouble() * (max - min);
    }

    /** Picks a random element from a list. */
    public <T> T pickOne(java.util.List<T> items) {
        if (items.isEmpty()) throw new IllegalArgumentException("Cannot pick from empty list");
        return items.get(random.nextInt(items.size()));
    }

    /** Picks a weighted random key from a distribution map (values must sum to ~1.0). */
    public String pickWeighted(java.util.Map<String, Double> distribution) {
        double roll = random.nextDouble();
        double cumulative = 0.0;
        for (var entry : distribution.entrySet()) {
            cumulative += entry.getValue();
            if (roll < cumulative) {
                return entry.getKey();
            }
        }
        // Fallback to last key (handles floating point drift)
        return distribution.keySet().stream().reduce((a, b) -> b).orElseThrow();
    }

    /** Returns a Gaussian-distributed value centered at mean with given stddev. */
    public double gaussian(double mean, double stddev) {
        return mean + random.nextGaussian() * stddev;
    }

    /** Returns the underlying Random instance. Use only when needed for shuffle etc. */
    public Random underlying() {
        return random;
    }
}
