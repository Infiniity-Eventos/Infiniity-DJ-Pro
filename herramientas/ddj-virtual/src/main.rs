// Controladora virtual: crea un puerto ALSA llamado "DDJ-200" y manda por el
// cada linea leida de stdin con bytes en hex, p.ej. "90 0B 7F".
use midir::os::unix::VirtualOutput;
use midir::MidiOutput;
use std::io::BufRead;
fn main() {
    let out = MidiOutput::new("DDJ-200").expect("midi");
    let mut conn = out.create_virtual("DDJ-200").expect("puerto virtual");
    eprintln!("puerto DDJ-200 listo");
    for line in std::io::stdin().lock().lines() {
        let line = line.unwrap();
        let bytes: Vec<u8> = line.split_whitespace().filter_map(|h| u8::from_str_radix(h, 16).ok()).collect();
        if bytes.is_empty() { continue; }
        conn.send(&bytes).expect("send");
        eprintln!("enviado {:02X?}", bytes);
    }
}
