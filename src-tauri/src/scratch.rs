use mailparse::addrparse;

fn main() {
    let addrs = addrparse("John Doe <john@example.com>, jane@example.com").unwrap();
    for addr in addrs {
        match addr {
            mailparse::MailAddr::Single(info) => {
                println!("Name: {:?}, Email: {}", info.display_name, info.addr);
            }
            mailparse::MailAddr::Group(info) => {
                println!("Group: {}", info.group_name);
            }
        }
    }
}
