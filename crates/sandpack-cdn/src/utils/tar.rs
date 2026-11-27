use std::{io::Cursor, path::Path};

use flate2::read::GzDecoder;
use tar::Archive;
use bytes::Bytes;

use crate::app_error::ServerError;

// We always assume the tarball is gzipped, non-gzipped tarballs will throw an error.
#[tracing::instrument(name = "store_tarball", skip(content))]
pub fn store_tarball(content: Cursor<Bytes>, target_dir: &Path) -> Result<(), ServerError> {
    let mut archive = open_tarball(content)?;
    archive.unpack(target_dir)?;
    make_readable(target_dir)?;
    Ok(())
}

/// Unpacking applies the modes recorded in the tarball. A package published
/// from Windows records its directories without the search bit (`drw-rw-rw-`),
/// and such a directory cannot be entered on Unix: every file in it would be
/// unreadable to the process that just wrote it.
#[cfg(unix)]
fn make_readable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    let mode = metadata.permissions().mode();
    let needed = if metadata.is_dir() { 0o700 } else { 0o400 };
    if mode & needed != needed {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode | needed))?;
    }
    if metadata.is_dir() {
        for entry in std::fs::read_dir(path)? {
            make_readable(&entry?.path())?;
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn make_readable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

// We always assume the tarball is gzipped, non-gzipped tarballs will throw an error.
#[tracing::instrument(name = "open_tarball", skip(content))]
pub fn open_tarball(
    content: Cursor<Bytes>,
) -> Result<Archive<GzDecoder<Cursor<Bytes>>>, ServerError> {
    let tar = GzDecoder::new(content);
    let archive = Archive::new(tar);
    Ok(archive)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};

    // react-use-measure 2.1.7 is such a tarball: /dep_tree answered 500
    // ("Permission denied") for every tree that contains it.
    #[test]
    fn a_tarball_whose_directories_lack_the_search_bit_is_readable_after_unpacking() {
        let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::default()));
        let mut directory = tar::Header::new_gnu();
        directory.set_entry_type(tar::EntryType::Directory);
        directory.set_mode(0o666);
        directory.set_size(0);
        directory.set_cksum();
        builder.append_data(&mut directory, "package/dist", std::io::empty()).unwrap();
        let content = b"module.exports = 1;";
        let mut file = tar::Header::new_gnu();
        file.set_mode(0o200);
        file.set_size(content.len() as u64);
        file.set_cksum();
        builder.append_data(&mut file, "package/dist/index.js", &content[..]).unwrap();
        let bytes = builder.into_inner().unwrap().finish().unwrap();

        let target = std::env::temp_dir().join(format!("sandpack-cdn-tar-test-{}", nanoid::nanoid!()));
        store_tarball(Cursor::new(Bytes::from(bytes)), &target).unwrap();

        let read = std::fs::read_to_string(target.join("package/dist/index.js"));
        let _ = std::fs::remove_dir_all(&target);
        assert_eq!(read.unwrap(), "module.exports = 1;");
    }
}
