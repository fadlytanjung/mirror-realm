# apps/api/app/domain/physics.py
# docs: 04-domain-model.md#physics
PLAYER_W = 24
PLAYER_H = 32

GRAVITY = 1400.0          # px/s² downward
MOVE_VEL = 250.0          # px/s horizontal
JUMP_VEL = 600.0          # px/s upward impulse on jump

# Derived (for sanity / agent prompt):
MAX_JUMP_HEIGHT = 128.0   # ≈ JUMP_VEL² / (2 * GRAVITY)
MAX_JUMP_DISTANCE = 220.0 # horizontal reach during one jump arc at MOVE_VEL
COYOTE_FRAMES = 6         # forgiveness window when running off ledge

WORLD_W = 1920
WORLD_H = 540
