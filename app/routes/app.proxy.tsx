import { ActionFunction, LoaderFunction, json } from "@remix-run/node";
import prisma from "../db.server";
import shopify from "../shopify.server";

/**
 * Loader function xử lý GET request để lấy danh sách đánh giá
 */
export const loader: LoaderFunction = async ({ request }) => {
  // Lấy URL và parse các tham số
  const url = new URL(request.url);
  console.log("Request URL:", request.url);

  // Trong môi trường App Proxy của Shopify, URL có dạng:
  // /api/auth/proxy?shop=xxx&path_prefix=%2Fapps%2Freviews&...
  const shopParam = url.searchParams.get("shop");
  const pathPrefix = url.searchParams.get("path_prefix");
  const productId = url.searchParams.get("productId");

  // Log các tham số để debug
  console.log("Shop:", shopParam);
  console.log("Path Prefix:", pathPrefix);
  console.log("Product ID:", productId);

  // Kiểm tra xem đây có phải là App Proxy request không
  if (pathPrefix && pathPrefix.includes("/apps/reviews")) {
    // Xử lý request lấy danh sách đánh giá
    if (productId) {
      try {
        // Lấy tất cả đánh giá của sản phẩm này
        const productReviews = await prisma.reviews.findMany({
          where: {
            productId,
          },
        });

        console.log(
          `Tìm thấy ${productReviews.length} đánh giá cho sản phẩm ${productId}`,
        );

        // Tính trung bình đánh giá
        const totalRating = productReviews.reduce(
          (sum, review) => sum + review.rating,
          0,
        );
        const averageRating =
          productReviews.length > 0 ? totalRating / productReviews.length : 0;

        // Trả về dữ liệu đánh giá
        return json(
          {
            productId,
            averageRating: parseFloat(averageRating.toFixed(1)),
            totalReviews: productReviews.length,
            reviews: productReviews.map((review) => ({
              id: review.id,
              rating: review.rating,
              author: review.author,
              body: review.body,
              createdAt: review.createdAt,
              title: "", // Trường title không có trong DB, nhưng cần cho hiển thị
              productName: (review as any).productName,
            })),
            timestamp: new Date().toISOString(), // Thêm timestamp để debug
          },
          {
            headers: {
              // Các header cần thiết cho CORS và vô hiệu hóa cache
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-store, max-age=0, must-revalidate",
              Pragma: "no-cache",
              Expires: "0",
            },
          },
        );
      } catch (error) {
        console.error("Lỗi khi lấy dữ liệu đánh giá:", error);
        return json({ error: "Lỗi khi lấy dữ liệu đánh giá" }, { status: 500 });
      }
    } else {
      // Nếu không có productId
      return json({ error: "Thiếu productId" }, { status: 400 });
    }
  }

  // Trả về thông tin mặc định nếu không phải App Proxy request
  return json({
    message: "Endpoint App Proxy cho đánh giá sản phẩm",
    info: "Vui lòng thêm tham số productId để lấy đánh giá",
  });
};

/**
 * Action function xử lý POST request để thêm đánh giá
 */
export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const rating = parseInt(formData.get("rating") as string);
  const author = formData.get("author") as string;
  const email = formData.get("email") as string;
  const title = formData.get("title") as string;
  const body = formData.get("body") as string;
  const productId = formData.get("product_id") as string;
  const productName =
    (formData.get("product_name") as string) || "Unknown Product";

  console.log("Review Data:", {
    productId,
    rating,
    author,
    email,
    title,
    body,
    productName,
  });

  // Lưu đánh giá vào cơ sở dữ liệu
  try {
    // Lưu đánh giá vào Prisma - phải có trường productName vì nó bắt buộc trong DB
    console.log("Đang lưu đánh giá mới vào DB với productId:", productId);
    const newReview = await prisma.reviews.create({
      data: {
        productId,
        rating,
        author,
        email,
        body,
        productName,
      },
    });
    console.log("Đã lưu đánh giá thành công với ID:", newReview.id);
    console.log("Đang tìm tất cả đánh giá của sản phẩm:", productId);

    // Lấy tất cả đánh giá của sản phẩm này
    const productReviews = await prisma.reviews.findMany({
      where: {
        productId,
      },
    });
    console.log(
      `Tìm thấy ${productReviews.length} đánh giá cho sản phẩm ${productId}`,
    );

    // Tính trung bình đánh giá
    const totalRating = productReviews.reduce(
      (sum, review) => sum + review.rating,
      0,
    );
    const averageRating =
      productReviews.length > 0 ? totalRating / productReviews.length : 0;
    console.log("cập nhật metafield cho đánh giá trung bình");

    try {
      // Cập nhật metafield của sản phẩm - đặt trong khối try/catch riêng
      console.log("test trước khi lấy admin");
      const { admin } = await shopify.authenticate.admin(request);
      console.log("lấy admin");
      // Cập nhật metafield cho đánh giá trung bình
      await admin.graphql(
        `
        mutation updateProductMetafield($input: MetafieldsSetInput!) {
          metafieldsSet(metafields: $input) {
            metafields {
              key
              namespace
              value
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
        {
          variables: {
            input: {
              ownerId: `gid://shopify/Product/${productId}`,
              metafields: [
                {
                  namespace: "reviews",
                  key: "rating",
                  value: JSON.stringify({ rating: averageRating.toFixed(1) }),
                  type: "json",
                },
              ],
            },
          },
        },
      );
      console.log("cập nhật metafield cho danh sách đánh giá");
      // Cập nhật metafield cho danh sách đánh giá
      const reviewsData = productReviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        name: review.author,
        email: review.email,
        title: title,
        body: review.body,
        created_at: review.createdAt,
      }));

      await admin.graphql(
        `
        mutation updateProductReviewsMetafield($input: MetafieldsSetInput!) {
          metafieldsSet(metafields: $input) {
            metafields {
              key
              namespace
              value
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
        {
          variables: {
            input: {
              ownerId: `gid://shopify/Product/${productId}`,
              metafields: [
                {
                  namespace: "prapp-pub",
                  key: "reviews",
                  value: JSON.stringify(reviewsData),
                  type: "json",
                },
              ],
            },
          },
        },
      );
    } catch (authError) {
      console.error("Lỗi xác thực Shopify API:", authError);
      // Vẫn trả về thành công vì review đã được lưu vào DB
      return json({
        success: true,
        message:
          "Đánh giá đã được lưu nhưng chưa cập nhật được lên cửa hàng. Vui lòng đăng nhập lại để đồng bộ dữ liệu.",
        auth_error: true,
      });
    }

    return json({ success: true, message: "Đánh giá đã được gửi thành công" });
  } catch (dbError) {
    console.error("Lỗi truy vấn DB:", dbError);
    // Vẫn trả về thành công vì review đã được lưu vào DB
    return json(
      {
        success: false,
        message:
          "Có lỗi xảy ra khi lưu đánh giá hoặc tính toán xếp hạng trung bình.",
        db_error: true,
      },
      { status: 500 },
    );
  }
};
