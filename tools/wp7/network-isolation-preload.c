#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

static int (*real_connect_fn)(int, const struct sockaddr *, socklen_t) = NULL;

static int is_loopback_address(const struct sockaddr *address, socklen_t length) {
  if (address == NULL) return 0;
  if (address->sa_family == AF_UNIX) return 1;
  if (address->sa_family == AF_INET && length >= sizeof(struct sockaddr_in)) {
    const struct sockaddr_in *value = (const struct sockaddr_in *)address;
    const unsigned long host = ntohl(value->sin_addr.s_addr);
    return (host & 0xff000000UL) == 0x7f000000UL;
  }
  if (address->sa_family == AF_INET6 && length >= sizeof(struct sockaddr_in6)) {
    const struct sockaddr_in6 *value = (const struct sockaddr_in6 *)address;
    return IN6_IS_ADDR_LOOPBACK(&value->sin6_addr);
  }
  return 0;
}

static void write_pre_main_proof(void) {
  const char *proof_dir = getenv("WP7_NETWORK_ISOLATION_PROOF_DIR");
  const char *nonce = getenv("WP7_NETWORK_ISOLATION_NONCE");
  if (proof_dir == NULL || proof_dir[0] == '\0' || nonce == NULL || nonce[0] == '\0') _exit(191);
  char proof_path[4096];
  int path_length = snprintf(proof_path, sizeof(proof_path), "%s/%ld.json", proof_dir, (long)getpid());
  if (path_length <= 0 || (size_t)path_length >= sizeof(proof_path)) _exit(195);
  int fd = open(proof_path, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, S_IRUSR | S_IWUSR);
  if (fd < 0) _exit(192);
  struct timespec now;
  if (clock_gettime(CLOCK_REALTIME, &now) != 0) _exit(193);
  char document[1024];
  int length = snprintf(document, sizeof(document),
    "{\"schemaVersion\":1,\"documentType\":\"WP7_NETWORK_ISOLATION_PRE_MAIN_PROOF\",\"pid\":%ld,\"parentPid\":%ld,\"nonce\":\"%s\",\"unixSeconds\":%lld,\"unixNanoseconds\":%ld}\n",
    (long)getpid(), (long)getppid(), nonce, (long long)now.tv_sec, now.tv_nsec);
  if (length <= 0 || (size_t)length >= sizeof(document) || write(fd, document, (size_t)length) != length || fsync(fd) != 0 || close(fd) != 0) _exit(194);
}

__attribute__((constructor)) static void wp7_network_isolation_constructor(void) {
  write_pre_main_proof();
}

int connect(int socket_fd, const struct sockaddr *address, socklen_t address_length) {
  if (!is_loopback_address(address, address_length)) {
    errno = ENETUNREACH;
    return -1;
  }
  if (real_connect_fn == NULL) {
    real_connect_fn = dlsym(RTLD_NEXT, "connect");
    if (real_connect_fn == NULL) {
      errno = ENOSYS;
      return -1;
    }
  }
  return real_connect_fn(socket_fd, address, address_length);
}
