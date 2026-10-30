# 📚 Tài Liệu Hướng Dẫn Sử Dụng API (Drama Streaming Service)

Hệ thống cung cấp toàn bộ API backend phục vụ cho ứng dụng xem phim ngắn (Short Drama), hoạt hình (Anime), bao gồm tìm kiếm, bảng xếp hạng, phân loại thể loại, phân trang bất tận, lấy luồng phát trực tiếp (HLS Stream .m3u8), phụ đề đa ngôn ngữ và track lồng tiếng.

---

## 🚀 1. Khởi Động & Truy Cập Nhanh

### 1.1. Chạy Backend Server
Mở terminal tại thư mục dự án và chạy:
```bash
node server.js
```
*(Hoặc nhấp đúp vào file `start_player.bat` trên Windows).*

### 1.2. Các Đường Dẫn Chính
| Dịch vụ | URL | Mô tả |
| :--- | :--- | :--- |
| **Giao diện Web Xem Phim** | `http://localhost:3000/player.html` | Web Player Dark Mode đầy đủ tính năng |
| **Swagger UI Interactive** | `http://localhost:3000/swagger.html` | Giao diện test & đọc tài liệu API trực quan |
| **OpenAPI Spec 3.0** | `http://localhost:3000/swagger.json` | File chuẩn OpenAPI để import vào Postman / Insomnia |
| **Base API URL** | `http://localhost:3000` | Tiền tố cho mọi endpoint bên dưới |

---

## 🌐 2. Quy Chuẩn & Tham Số Chung

### 2.1. CORS & Response Header
- Mọi endpoint đều đã được mở `Access-Control-Allow-Origin: *` cho phép gọi trực tiếp từ Web Frontend, Mobile App mà không bị chặn CORS.
- Định dạng dữ liệu trả về mặc định: `application/json; charset=utf-8`.

### 2.2. Tham số ngôn ngữ (`lang`)
Hỗ trợ truyền qua query parameter `?lang=...` hoặc header `Accept-Language`:
- `vi-VN` (Mặc định - Tiếng Việt)
- `en-US` (Tiếng Anh)
- `zh-CN` / `zh-TW` (Tiếng Trung)
- `th-TH` (Tiếng Thái)
- `id-ID` (Tiếng Indonesia)
- `es-MX` (Tiếng Tây Ban Nha)
- `ja-JP` (Tiếng Nhật)
- `ko-KR` (Tiếng Hàn)

---

## 📑 3. Danh Sách Chi Tiết Các Endpoints

---

### 🔹 3.1. Lấy Danh Sách Tabs & Thể Loại
Trả về cây danh mục gồm các Tab chính của ứng dụng và các bộ lọc thể loại (CEO, Trọng sinh, Ngôn tình, Gia đình, Người sói...).

- **Endpoint**: `GET /api/tabs`
- **Query Parameters**:
  - `lang` *(optional)*: Mã ngôn ngữ (mặc định: `vi-VN`).
- **Ví dụ cURL**:
  ```bash
  curl -X GET "http://localhost:3000/api/tabs?lang=vi-VN"
  ```
- **Response Format**:
  ```json
  {
    "code": 0,
    "data": {
      "list": [
        {
          "name": "Phim ngắn",
          "tab_key": "47",
          "children": [
            { "name": "Phổ biến", "tab_key": "503" },
            { "name": "Mới nhất", "tab_key": "505" },
            { "name": "Sắp ra mắt", "tab_key": "622" },
            { "name": "Nữ giới", "tab_key": "504" },
            { "name": "Nam giới", "tab_key": "506" }
          ]
        },
        {
          "name": "Hoạt Hình",
          "tab_key": "51",
          "children": [
            { "name": "Hoạt Hình", "tab_key": "547" }
          ]
        }
      ]
    }
  }
  ```

---

### 🔹 3.2. Lấy Danh Sách Phim Theo Tab (`tab-index`)
Nạp các khối danh sách phim (modules) thuộc về một Tab cụ thể.

- **Endpoint**: `GET /api/tab-index`
- **Query Parameters**:
  - `tab_key` *(required)*: ID của tab cần nạp.
    - `503`: Phổ biến
    - `505`: Mới nhất
    - `622`: Sắp ra mắt / Đang cập nhật (**hơn 240 bộ phim**)
    - `504`: Dành cho phái Nữ
    - `506`: Dành cho phái Nam
    - `547`: Hoạt hình / Anime
  - `lang` *(optional)*: Mã ngôn ngữ.
- **Ví dụ cURL**:
  ```bash
  curl -X GET "http://localhost:3000/api/tab-index?tab_key=622&lang=vi-VN"
  ```
- **Response Format**:
  ```json
  {
    "code": 0,
    "data": {
      "items": [
        {
          "module_name": "Phim Đang Hot",
          "module_key": "1238",
          "items": [
            {
              "key": "rnngzkMr4L",
              "title": "Trái Tim Va Chạm Trên Sân Đấu",
              "cover": "https://static-v1.mydramawave.com/vt/.../cover.jpg",
              "desc": "Tóm tắt nội dung phim...",
              "episode_count": 31,
              "series_tag": ["Lãng mạn", "Thanh thiếu niên"]
            }
          ]
        }
      ]
    }
  }
  ```

---

### 🔹 3.3. Cuộn Nạp Thêm Phim Vô Tận (`feed`)
Phân trang danh sách phim cho từng danh mục dựa trên token `next` (Deep Feed Pagination).

- **Endpoint**: `POST /api/feed` hoặc `GET /api/feed`
- **Query Parameters / Request Body**:
  - `module_key` *(required)*: Mã module feed (`1036`: Phổ biến, `1040`: Mới nhất, `1039`: Nữ giới, `1041`: Nam giới, `2204`: Anime).
  - `next` *(optional)*: Chuỗi offset từ lần nạp trước (để trống ở trang 1, ví dụ trang 2: `offset=10&position_index=`).
  - `lang` *(optional)*: Ngôn ngữ.
- **Ví dụ cURL**:
  ```bash
  curl -X GET "http://localhost:3000/api/feed?module_key=1036&next=offset=10&position_index=&lang=vi-VN"
  ```
- **Response Format**:
  ```json
  {
    "code": 0,
    "data": {
      "items": [ ... ],
      "page_info": {
        "next": "offset=20&position_index=",
        "has_more": true
      }
    }
  }
  ```

---

### 🔹 3.4. Bảng Xếp Hạng Phim Thịnh Hành (`rank`)
Lấy danh sách các bộ phim có lượt xem và điểm đánh giá cao nhất.

- **Endpoint**: `POST /api/rank` hoặc `GET /api/rank`
- **Query Parameters / Request Body**:
  - `page` *(optional)*: Số trang (mặc định: `1`).
  - `page_size` *(optional)*: Số lượng kết quả (mặc định: `20`).
  - `lang` *(optional)*: Ngôn ngữ.
- **Ví dụ cURL**:
  ```bash
  curl -X GET "http://localhost:3000/api/rank?page=1&lang=vi-VN"
  ```

---

### 🔹 3.5. Danh Sách Phim Đề Xuất Hot (`hot-list`)
- **Endpoint**: `POST /api/hot-list` hoặc `GET /api/hot-list`
- **Query Parameters**:
  - `page` *(optional)*: Trang cần lấy (mặc định: `1`).
  - `lang` *(optional)*: Ngôn ngữ.
- **Ví dụ cURL**:
  ```bash
  curl -X GET "http://localhost:3000/api/hot-list?page=1&lang=vi-VN"
  ```

---

### 🔹 3.6. Tìm Kiếm Phim (`search`)
Tìm kiếm theo tên phim, nhân vật hoặc nội dung cốt truyện.

- **Endpoint**: `POST /api/search` hoặc `GET /api/search`
- **Query Parameters / Request Body**:
  - `q` hoặc `keyword` *(required)*: Từ khóa tìm kiếm (ví dụ: `tong tai`, `tinh yeu`, `tra thu`).
  - `next` *(optional)*: Token trang tiếp theo.
  - `lang` *(optional)*: Ngôn ngữ.
- **Ví dụ cURL**:
  ```bash
  curl -X GET "http://localhost:3000/api/search?q=tổng+tài&lang=vi-VN"
  ```

---

### 🔹 3.7. Chi Tiết Phim & Danh Sách Toàn Bộ Tập (`drama`)
Đây là API quan trọng nhất để phát video. Cung cấp đầy đủ thông tin: tên phim, số tập, đường dẫn stream HLS (.m3u8), track lồng tiếng và file phụ đề VTT của từng tập.

- **Endpoint**: `GET /api/drama`
- **Query Parameters**:
  - `id` *(required)*: Series ID hoặc Drama Key (ví dụ: `14364` hoặc `MSD5LITVYi`, `rnngzkMr4L`).
  - `lang` *(optional)*: Ngôn ngữ.
- **Ví dụ cURL**:
  ```bash
  curl -X GET "http://localhost:3000/api/drama?id=14364&lang=vi-VN"
  ```
- **Response Format cốt lõi**:
  ```json
  {
    "code": 0,
    "data": {
      "info": {
        "id": 14364,
        "name": "Vợ Ơi Đừng Ly Hôn",
        "cover": "https://static-v1.mydramawave.com/vt/.../cover.jpg",
        "desc": "Tóm tắt phim...",
        "episode_count": 80,
        "episode_list": [
          {
            "id": 101,
            "name": "Tập 1",
            "video_url": "https://video-v6.mydramawave.com/.../h264.m3u8",
            "external_audio_h264_m3u8": "https://video-v6.mydramawave.com/.../external-audio.m3u8",
            "audio": ["vi-VN", "en-US", "zh-CN", "th-TH"],
            "original_audio_language": "zh-CN",
            "subtitle_list": [
              {
                "language": "vi-VN",
                "name": "Tiếng Việt",
                "subtitle": "https://video-v6.mydramawave.com/.../sub_vi.vtt"
              },
              {
                "language": "en-US",
                "name": "English",
                "subtitle": "https://video-v6.mydramawave.com/.../sub_en.vtt"
              }
            ]
          }
        ]
      }
    }
  }
  ```

> [!TIP]
> - Nếu phim có hỗ trợ **Lồng tiếng**, trường `external_audio_h264_m3u8` sẽ có giá trị và mảng `audio` liệt kê các ngôn ngữ lồng tiếng có sẵn.
> - Danh sách phụ đề nằm trong `subtitle_list` với định dạng `.vtt` chuẩn WebVTT.

---

### 🔹 3.8. CORS Proxy Media Streamer (`proxy`)
Bypass giới hạn kiểm tra CORS, Referer và Hotlink Protection của CDN máy chủ video, đồng thời rewrite tự động các đường dẫn tương đối trong playlist `.m3u8`.

- **Endpoint**: `GET /proxy`
- **Query Parameters**:
  - `url` *(required)*: URL gốc của file `.m3u8`, `.ts`, hoặc file phụ đề `.vtt`.
- **Cách dùng**:
  Thay vì phát trực tiếp `https://video-cdn.com/stream.m3u8`, hãy bọc qua proxy:
  ```text
  http://localhost:3000/proxy?url=https%3A%2F%2Fvideo-cdn.com%2Fstream.m3u8
  ```

---

### 🔹 3.9. Tải File Stream / Phụ Đề Về Máy (`download`)
Ép trình duyệt hoặc trình download tải file về máy với header `Content-Disposition: attachment`.

- **Endpoint**: `GET /api/download`
- **Query Parameters**:
  - `url` *(required)*: URL file cần tải.
  - `filename` *(optional)*: Tên file muốn lưu (ví dụ: `Tap_1.m3u8` hoặc `Phude_TiengViet.vtt`).
- **Ví dụ**:
  ```bash
  curl -O "http://localhost:3000/api/download?url=https://example.com/sub.vtt&filename=Tap1_sub.vtt"
  ```

---

## 💻 4. Code Mẫu Tích Hợp (SDK & Client Examples)

### 4.1. JavaScript (Web / Hls.js)
```javascript
import Hls from 'hls.js';

const API_BASE = 'http://localhost:3000';

// 1. Lấy thông tin phim
async function playEpisode(seriesId, episodeIndex = 0) {
    const res = await fetch(`${API_BASE}/api/drama?id=${seriesId}&lang=vi-VN`);
    const json = await res.json();
    const episode = json.data.info.episode_list[episodeIndex];

    // 2. Chọn luồng video (ưu tiên lồng tiếng nếu có)
    const rawStreamUrl = episode.external_audio_h264_m3u8 || episode.video_url || episode.m3u8_url;
    const proxiedStreamUrl = `${API_BASE}/proxy?url=${encodeURIComponent(rawStreamUrl)}`;

    const videoElement = document.getElementById('myVideo');

    // 3. Khởi tạo phát HLS
    if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(proxiedStreamUrl);
        hls.attachMedia(videoElement);
        hls.on(Hls.Events.MANIFEST_PARSED, () => videoElement.play());
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari iOS/macOS)
        videoElement.src = proxiedStreamUrl;
        videoElement.play();
    }

    // 4. Gắn phụ đề tiếng Việt
    const viSub = (episode.subtitle_list || []).find(s => s.language === 'vi-VN');
    if (viSub && viSub.subtitle) {
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = 'Tiếng Việt';
        track.srclang = 'vi';
        track.src = `${API_BASE}/proxy?url=${encodeURIComponent(viSub.subtitle)}`;
        track.default = true;
        videoElement.appendChild(track);
    }
}
```

---

### 4.2. Flutter (Mobile App)
Sử dụng package `http` và `video_player`:

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:video_player/video_player.dart';

const String apiBase = 'http://10.0.2.2:3000'; // 10.0.2.2 cho Android Emulator

Future<void> fetchAndPlayDrama(String dramaId) async {
  // 1. Gọi API lấy tập phim
  final response = await http.get(Uri.parse('$apiBase/api/drama?id=$dramaId&lang=vi-VN'));
  final data = jsonDecode(response.body);
  final firstEpisode = data['data']['info']['episode_list'][0];

  final String rawUrl = firstEpisode['video_url'];
  final String streamUrl = '$apiBase/proxy?url=${Uri.encodeComponent(rawUrl)}';

  // 2. Khởi tạo trình phát Video
  final controller = VideoPlayerController.networkUrl(Uri.parse(streamUrl));
  await controller.initialize();
  controller.play();
}
```

---

### 4.3. React Native
Sử dụng `react-native-video`:

```tsx
import React, { useEffect, useState } from 'react';
import Video from 'react-native-video';

const API_BASE = 'http://localhost:3000';

export const DramaPlayerScreen = ({ dramaId }) => {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/drama?id=${dramaId}&lang=vi-VN`)
      .then(res => res.json())
      .then(json => {
        const ep = json.data.info.episode_list[0];
        const rawUrl = ep.video_url || ep.m3u8_url;
        setStreamUrl(`${API_BASE}/proxy?url=${encodeURIComponent(rawUrl)}`);
      });
  }, [dramaId]);

  if (!streamUrl) return null;

  return (
    <Video
      source={{ uri: streamUrl, type: 'm3u8' }}
      controls={true}
      resizeMode="contain"
      style={{ width: '100%', height: 300 }}
    />
  );
};
```

---

### 4.4. Python (Data Crawl / Automation)
```python
import requests

API_BASE = "http://localhost:3000"

def get_drama_catalog():
    # Lấy danh sách 300+ phim mới nhất từ Tab 622
    res = requests.get(f"{API_BASE}/api/tab-index", params={"tab_key": "622", "lang": "vi-VN"})
    items = res.json()["data"]["items"][0]["items"]
    
    print(f"Đã lấy thành công {len(items)} bộ phim:")
    for d in items[:5]:
        print(f"- {d['title']} (ID: {d['key']}) - {d.get('episode_count', 0)} tập")

if __name__ == "__main__":
    get_drama_catalog()
```

---

## 🛠️ 5. Các Tính Năng Nâng Cao

### 5.1. Chuyển Đổi Kênh Lồng Tiếng (Audio Tracks)
Khi một tập phim có trường `external_audio_h264_m3u8`:
- Nếu phát bằng `Hls.js`: `Hls.js` tự động nhận diện các audio track có trong manifest. Bạn có thể duyệt danh sách qua `hls.audioTracks` và đổi ngôn ngữ qua `hls.audioTrack = trackIndex`.
- Các mã ngôn ngữ âm thanh thường gặp: `vi-VN` (Tiếng Việt), `en-US` (Tiếng Anh), `zh-CN` (Gốc tiếng Trung), `th-TH` (Tiếng Thái), `id-ID` (Tiếng Indonesia).

### 5.2. Chia Sẻ Phim & Tập Cụ Thể (Deep Linking)
Web Player hỗ trợ mở thẳng phim và tập thông qua URL parameters:
- Mở phim: `http://localhost:3000/player.html?drama=14364`
- Mở phim tại tập 5: `http://localhost:3000/player.html?drama=14364&ep=4` *(chỉ số index tính từ 0)*.

---

## ❓ 6. Xử Lý Sự Cố Thường Gặp (Troubleshooting)

1. **Lỗi `Failed to fetch` hoặc `Network Error`**:
   - Đảm bảo server backend đang chạy (`node server.js`).
   - Nếu chạy trên điện thoại hoặc máy ảo, thay `localhost` bằng địa chỉ IP LAN của máy tính (ví dụ: `192.168.1.15:3000`) hoặc `10.0.2.2:3000` (đối với Android Emulator).
2. **Video không phát hoặc màn hình đen**:
   - Đảm bảo đường dẫn video `.m3u8` đã được bọc qua `/proxy?url=...` để tránh bị CDN chặn CORS và hotlink.
3. **Phụ đề hiển thị sai vị trí hoặc bị che mất**:
   - Sử dụng CSS `video::cue { font-size: 13px !important; }` để định dạng kích cỡ và khoảng cách hiển thị chữ theo ý muốn.
