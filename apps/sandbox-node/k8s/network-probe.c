/* Qualification only: direct Linux socket syscalls, without language-runtime emulation. */
#include <arpa/inet.h>
#include <errno.h>
#include <linux/if_packet.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

static int denied(int error) {
  return error == ENETUNREACH || error == EHOSTUNREACH || error == ECONNREFUSED ||
    error == EACCES || error == EPERM || error == EADDRNOTAVAIL;
}
static int address(const char *host, int port, struct sockaddr_storage *addr) {
  memset(addr, 0, sizeof(*addr));
  if (strchr(host, ':')) {
    struct sockaddr_in6 *a = (void *)addr; a->sin6_family = AF_INET6; a->sin6_port = htons(port);
    return inet_pton(AF_INET6, host, &a->sin6_addr) == 1 ? sizeof(*a) : 0;
  }
  struct sockaddr_in *a = (void *)addr; a->sin_family = AF_INET; a->sin_port = htons(port);
  return inet_pton(AF_INET, host, &a->sin_addr) == 1 ? sizeof(*a) : 0;
}
int main(int argc, char **argv) {
  if (argc == 2 && !strcmp(argv[1], "raw")) {
    int raw = socket(AF_INET, SOCK_RAW, IPPROTO_ICMP), r = errno;
    int packet = socket(AF_PACKET, SOCK_RAW, htons(3)), p = errno;
    printf("[{\"name\":\"raw socket refused\",\"ok\":%s},{\"name\":\"packet socket refused\",\"ok\":%s}]",
      raw < 0 && (r == EPERM || r == EACCES) ? "true" : "false",
      packet < 0 && (p == EPERM || p == EACCES) ? "true" : "false");
    if (raw >= 0) close(raw);
    if (packet >= 0) close(packet);
    return 0;
  }
  if (argc == 2 && !strcmp(argv[1], "witness")) {
    for (int v6 = 0; v6 < 2; v6++) for (int udp = 0; udp < 2; udp++) {
      struct sockaddr_storage a; int n = address(v6 ? "::1" : "127.0.0.1", 8444, &a);
      int fd = socket(a.ss_family, udp ? SOCK_DGRAM : SOCK_STREAM, 0), one = 1;
      if (fd < 0) return 1;
      if (v6 && setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &one, sizeof(one))) return 1;
      if (bind(fd, (void *)&a, n) || (!udp && listen(fd, 8))) return 1;
    }
    puts("READY kernel TCP/UDP witnesses IPv4/IPv6"); fflush(stdout);
    for (;;) pause();
  }
  if (argc != 4 || (strcmp(argv[1], "udp") && strcmp(argv[1], "udp-egress"))) return 2;
  struct sockaddr_storage a; int n = address(argv[2], atoi(argv[3]), &a);
  if (!n) return 2;
  int fd = socket(a.ss_family, SOCK_DGRAM, 0);
  if (fd < 0) return 2;
  if (connect(fd, (void *)&a, n) || send(fd, "qualification", 13, 0) < 0) return denied(errno) ? 0 : 1;
  /* A remote ICMP port-unreachable proves delivery, not egress isolation. */
  if (!strcmp(argv[1], "udp-egress")) return 1;
  struct pollfd pollfd = { .fd = fd, .events = POLLIN | POLLERR };
  if (poll(&pollfd, 1, 500) <= 0) return 1;
  char bytes[32]; int result = recv(fd, bytes, sizeof(bytes), MSG_DONTWAIT);
  return result < 0 && denied(errno) ? 0 : 1;
}
