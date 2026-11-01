package dev.suli.t3minecraft;

import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.DistExecutor;
import net.minecraftforge.fml.common.Mod;

@Mod("t3minecraft")
public final class T3MinecraftMod {
    public T3MinecraftMod() {
        DistExecutor.safeRunWhenOn(Dist.CLIENT, () -> T3MinecraftClient::initialize);
    }
}
