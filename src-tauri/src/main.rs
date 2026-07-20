// Evita abrir una consola extra en Windows (no aplica en Linux, pero es buena practica).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    infiniity_dj_lib::run();
}
